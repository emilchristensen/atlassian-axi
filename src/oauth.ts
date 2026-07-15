import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { platform } from "node:os";
import {
  readOAuthSession,
  resolveOAuthClientSecret,
  saveOAuthSession,
  type OAuthSession,
} from "./config.js";
import { AxiError } from "./errors.js";

/**
 * Atlassian OAuth 2.0 (3LO) client for the Confluence REST half. Atlassian
 * treats 3LO apps as confidential clients: the token exchange needs the client
 * secret (env `ATLASSIAN_AXI_OAUTH_CLIENT_SECRET` or stored 0600 config —
 * never committed, never argv). Refresh tokens ROTATE: every refresh response
 * carries a new one and the old one dies, so callers must always persist the
 * newest (refreshSession does).
 */

/** The registered atlassian-axi 3LO app. The client ID is public by design. */
export const DEFAULT_OAUTH_CLIENT_ID = "rwIB6Tt3xeLL0NW0Z5ciYUIQNfVXDmXy";
export const OAUTH_AUTHORIZE_URL = "https://auth.atlassian.com/authorize";
export const OAUTH_TOKEN_URL = "https://auth.atlassian.com/oauth/token";
export const ACCESSIBLE_RESOURCES_URL =
  "https://api.atlassian.com/oauth/token/accessible-resources";
/** Must match the callback URL registered in the app exactly. */
export const OAUTH_CALLBACK_PORT = 8765;
export const OAUTH_REDIRECT_URI = "http://localhost:8765/callback";

/**
 * Requested scopes: the Confluence set + offline_access (refresh tokens).
 * The app is also GRANTED read:jira-work/write:jira-work/read:jira-user, but
 * the OAuth session only ever drives the Confluence REST half (acli cannot use
 * a Bearer token), so the Jira scopes are deliberately not requested — least
 * privilege for a token that sits in the on-disk config.
 */
export const OAUTH_SCOPES = [
  "read:confluence-content.all",
  "write:confluence-content",
  "read:confluence-space.summary",
  "search:confluence",
  "offline_access",
].join(" ");

/** Refresh this long before nominal expiry so in-flight calls never race it. */
const EXPIRY_SKEW_MS = 60_000;
const CALLBACK_TIMEOUT_MS = 300_000;

/** Active OAuth client id: env override (for forks) > shipped default. */
export function oauthClientId(): string {
  const env = process.env["ATLASSIAN_AXI_OAUTH_CLIENT_ID"];
  return env && env.trim() !== "" ? env.trim() : DEFAULT_OAUTH_CLIENT_ID;
}

// ---------------------------------------------------------------------------
// Injectable fetch (tests never hit auth.atlassian.com / api.atlassian.com)
// ---------------------------------------------------------------------------

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

let injectedFetch: FetchLike | null = null;

/** Override the fetch used for OAuth endpoints; `null` restores global fetch. */
export function setOAuthFetch(next: FetchLike | null): void {
  injectedFetch = next;
}

function activeFetch(): FetchLike {
  return injectedFetch ?? (fetch as FetchLike);
}

// ---------------------------------------------------------------------------
// Authorize URL + CSRF state
// ---------------------------------------------------------------------------

/** Random URL-safe state parameter binding the callback to this invocation. */
export function generateState(): string {
  return randomBytes(24).toString("base64url");
}

/** Build the browser authorize URL (3LO code flow, offline_access included). */
export function buildAuthorizeUrl(options: {
  clientId: string;
  state: string;
}): string {
  const url = new URL(OAUTH_AUTHORIZE_URL);
  url.searchParams.set("audience", "api.atlassian.com");
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("scope", OAUTH_SCOPES);
  url.searchParams.set("redirect_uri", OAUTH_REDIRECT_URI);
  url.searchParams.set("state", options.state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

// ---------------------------------------------------------------------------
// Token endpoint (exchange + refresh)
// ---------------------------------------------------------------------------

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  scopes: string;
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  error?: unknown;
  error_description?: unknown;
}

async function tokenRequest(
  body: Record<string, string>,
  failureCode: "AUTH_REQUIRED" | "VALIDATION_ERROR",
  failureHint: string[],
): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await activeFetch()(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "request failed";
    throw new AxiError(`OAuth token request failed: ${reason}`, "UNKNOWN", [
      "Check the network and retry",
    ]);
  }
  const text = await response.text().catch(() => "");
  let parsed: TokenResponse = {};
  try {
    parsed = JSON.parse(text) as TokenResponse;
  } catch {
    // Non-JSON error page; fall through to the status check with the raw text.
  }
  if (!response.ok) {
    const detail =
      typeof parsed.error_description === "string" && parsed.error_description
        ? parsed.error_description
        : typeof parsed.error === "string" && parsed.error
          ? parsed.error
          : text.slice(0, 200) || `HTTP ${response.status}`;
    throw new AxiError(
      `Atlassian token endpoint rejected the request: ${detail}`,
      failureCode,
      failureHint,
    );
  }
  return parsed;
}

function tokenSetFrom(
  parsed: TokenResponse,
  fallbackRefreshToken: string | undefined,
  context: string,
): TokenSet {
  const accessToken = parsed.access_token;
  const expiresIn = parsed.expires_in;
  if (typeof accessToken !== "string" || accessToken === "") {
    throw new AxiError(
      `Atlassian token response is missing access_token (${context})`,
      "UNKNOWN",
    );
  }
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn)) {
    throw new AxiError(
      `Atlassian token response is missing expires_in (${context})`,
      "UNKNOWN",
    );
  }
  const refreshToken =
    typeof parsed.refresh_token === "string" && parsed.refresh_token !== ""
      ? parsed.refresh_token
      : fallbackRefreshToken;
  if (!refreshToken) {
    throw new AxiError(
      `Atlassian token response carried no refresh_token (${context}) — is offline_access granted to the app?`,
      "UNKNOWN",
    );
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    scopes: typeof parsed.scope === "string" ? parsed.scope : "",
  };
}

/** Exchange the authorization code for the initial token set. */
export async function exchangeAuthorizationCode(options: {
  clientId: string;
  clientSecret: string;
  code: string;
}): Promise<TokenSet> {
  const parsed = await tokenRequest(
    {
      grant_type: "authorization_code",
      client_id: options.clientId,
      client_secret: options.clientSecret,
      code: options.code,
      redirect_uri: OAUTH_REDIRECT_URI,
    },
    "AUTH_REQUIRED",
    [
      "Re-run `atlassian-axi auth login` — the authorization code is single-use and short-lived",
      "If it keeps failing, verify the client secret (ATLASSIAN_AXI_OAUTH_CLIENT_SECRET)",
    ],
  );
  return tokenSetFrom(parsed, undefined, "code exchange");
}

/** Redeem the rotating refresh token for a fresh token set. */
export async function refreshAccessToken(options: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<TokenSet> {
  const parsed = await tokenRequest(
    {
      grant_type: "refresh_token",
      client_id: options.clientId,
      client_secret: options.clientSecret,
      refresh_token: options.refreshToken,
    },
    "AUTH_REQUIRED",
    ["Run `atlassian-axi auth login` to re-authenticate (the refresh token expired or was revoked)"],
  );
  return tokenSetFrom(parsed, options.refreshToken, "refresh");
}

// ---------------------------------------------------------------------------
// Accessible resources (cloudId discovery)
// ---------------------------------------------------------------------------

export interface AccessibleResource {
  id: string;
  url: string;
  name: string;
  scopes: string[];
}

/** List the Atlassian sites (cloud ids) this token can address. */
export async function fetchAccessibleResources(
  accessToken: string,
): Promise<AccessibleResource[]> {
  let response: Response;
  try {
    response = await activeFetch()(ACCESSIBLE_RESOURCES_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "request failed";
    throw new AxiError(
      `Failed to list accessible Atlassian sites: ${reason}`,
      "UNKNOWN",
      ["Check the network and retry"],
    );
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new AxiError(
      `Failed to list accessible Atlassian sites (HTTP ${response.status}): ${text.slice(0, 200)}`,
      response.status === 401 ? "AUTH_REQUIRED" : "UNKNOWN",
    );
  }
  const parsed = (await response.json()) as unknown;
  if (!Array.isArray(parsed)) {
    throw new AxiError(
      "Unexpected accessible-resources response (expected an array)",
      "UNKNOWN",
    );
  }
  return parsed
    .filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null,
    )
    .map((entry) => ({
      id: typeof entry.id === "string" ? entry.id : "",
      url: typeof entry.url === "string" ? entry.url : "",
      name: typeof entry.name === "string" ? entry.name : "",
      scopes: Array.isArray(entry.scopes)
        ? entry.scopes.filter((s): s is string => typeof s === "string")
        : [],
    }))
    .filter((entry) => entry.id !== "" && entry.url !== "");
}

// ---------------------------------------------------------------------------
// Session freshness (transparent refresh; persists the rotated refresh token)
// ---------------------------------------------------------------------------

/** Whether the session's access token is (about to be) expired. */
export function isSessionExpired(session: OAuthSession): boolean {
  return session.expiresAt - EXPIRY_SKEW_MS <= Date.now();
}

/**
 * Force-refresh the session and persist the rotated tokens. Throws
 * AUTH_REQUIRED (pointing at `auth login`) when the client secret is missing
 * or the refresh token is no longer valid.
 *
 * Rotating-token race guard: two concurrent CLI processes can both hold the
 * same refresh token; the loser's refresh fails (`invalid_grant`) even though
 * the winner already persisted a perfectly good session. Before surfacing
 * that failure, re-read the store — if a sibling rotated the token underneath
 * us, use its session instead (retrying its refresh at most once).
 */
export async function refreshSession(
  session: OAuthSession,
  siblingRetry = true,
): Promise<OAuthSession> {
  const secret = resolveOAuthClientSecret(session);
  if (!secret) {
    throw new AxiError(
      "OAuth client secret is not available — cannot refresh the access token",
      "AUTH_REQUIRED",
      [
        "Set ATLASSIAN_AXI_OAUTH_CLIENT_SECRET, or re-run `atlassian-axi auth login` (it stores the secret)",
      ],
    );
  }
  let tokens: TokenSet;
  try {
    tokens = await refreshAccessToken({
      clientId: session.clientId,
      clientSecret: secret.secret,
      refreshToken: session.refreshToken,
    });
  } catch (error) {
    const stored = readOAuthSession();
    if (
      siblingRetry &&
      stored &&
      stored.refreshToken !== session.refreshToken
    ) {
      return isSessionExpired(stored) ? refreshSession(stored, false) : stored;
    }
    throw error;
  }
  const next: OAuthSession = {
    ...session,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    scopes: tokens.scopes || session.scopes,
  };
  saveOAuthSession(next);
  return next;
}

/** Return a session with a valid access token, refreshing (and persisting) if needed. */
export async function ensureFreshSession(
  session: OAuthSession,
): Promise<OAuthSession> {
  return isSessionExpired(session) ? refreshSession(session) : session;
}

// ---------------------------------------------------------------------------
// Localhost callback listener
// ---------------------------------------------------------------------------

export interface CallbackServer {
  /** The bound port (equals the requested port unless 0 was passed in tests). */
  port: number;
  /** Resolves with the authorization code, rejects on error/state-mismatch/timeout. */
  result: Promise<{ code: string }>;
  close(): void;
}

const CALLBACK_HTML = `<!doctype html><meta charset="utf-8"><title>atlassian-axi</title>
<body style="font-family: system-ui; margin: 4rem auto; max-width: 30rem; text-align: center;">
<h1>atlassian-axi</h1><p>Login complete — you can close this tab and return to the terminal.</p></body>`;

/** Constant-time state comparison (the state is the only CSRF credential). */
function stateMatches(expected: string, actual: string | null): boolean {
  if (!actual) {
    return false;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Start the localhost callback listener. The port must be 8765 in the real
 * flow (the app's registered callback URL is fixed); tests pass 0 for an
 * ephemeral port. The redirect host is `localhost`, which may resolve to
 * ::1 first on some machines, so a best-effort second listener binds ::1
 * alongside the authoritative 127.0.0.1 one. The server handles exactly one
 * state-authenticated callback then closes; requests WITHOUT a valid state
 * (any local process, or a drive-by web page firing fetch() at the port) get
 * a 400 and the listener keeps waiting — they must not be able to cancel a
 * pending login.
 */
export function startCallbackServer(options: {
  port: number;
  expectedState: string;
  timeoutMs?: number;
}): Promise<CallbackServer> {
  const timeoutMs = options.timeoutMs ?? CALLBACK_TIMEOUT_MS;
  return new Promise((resolveStart, rejectStart) => {
    let settle: (outcome: { code: string } | AxiError) => void = () => {};
    const result = new Promise<{ code: string }>((resolve, reject) => {
      settle = (outcome) => {
        if (outcome instanceof AxiError) reject(outcome);
        else resolve(outcome);
      };
    });
    // The callback can arrive before the caller awaits `result`; this no-op
    // branch keeps an early rejection from surfacing as unhandled.
    result.catch(() => {});

    const servers: Server[] = [];
    const closeAll = () => {
      clearTimeout(timer);
      for (const server of servers) {
        server.close();
      }
    };

    const handler = (
      req: import("node:http").IncomingMessage,
      res: import("node:http").ServerResponse,
    ) => {
      const url = new URL(req.url ?? "/", `http://localhost`);
      if (url.pathname !== "/callback") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }

      // State first: only a redirect carrying OUR unguessable state may settle
      // the flow. Everything else is answered and ignored.
      if (!stateMatches(options.expectedState, url.searchParams.get("state"))) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<p>State mismatch — stale or foreign request; return to the terminal.</p>");
        return;
      }

      const finish = (outcome: { code: string } | AxiError, body: string) => {
        res.writeHead(outcome instanceof AxiError ? 400 : 200, {
          "Content-Type": "text/html; charset=utf-8",
        });
        res.end(body);
        closeAll();
        settle(outcome);
      };

      const errorParam = url.searchParams.get("error");
      if (errorParam) {
        const description =
          url.searchParams.get("error_description") ?? errorParam;
        finish(
          new AxiError(
            `Atlassian authorization failed: ${description}`,
            errorParam === "access_denied" ? "AUTH_REQUIRED" : "UNKNOWN",
            ["Re-run `atlassian-axi auth login` and approve the consent screen"],
          ),
          "<p>Authorization failed — return to the terminal.</p>",
        );
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) {
        finish(
          new AxiError(
            "OAuth callback carried no authorization code",
            "UNKNOWN",
            ["Re-run `atlassian-axi auth login`"],
          ),
          "<p>Missing authorization code — return to the terminal.</p>",
        );
        return;
      }
      finish({ code }, CALLBACK_HTML);
    };

    const timer = setTimeout(() => {
      closeAll();
      settle(
        new AxiError(
          `Timed out waiting for the browser callback (${Math.round(timeoutMs / 1000)}s)`,
          "UNKNOWN",
          ["Re-run `atlassian-axi auth login` and complete the consent screen"],
        ),
      );
    }, timeoutMs);
    timer.unref?.();

    const primary = createServer(handler);
    servers.push(primary);

    primary.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (error.code === "EADDRINUSE") {
        rejectStart(
          new AxiError(
            `Port ${options.port} is already in use — the OAuth callback listener cannot start`,
            "UNKNOWN",
            [
              `Free port ${options.port} (the app's registered callback is http://localhost:${OAUTH_CALLBACK_PORT}/callback) and retry`,
            ],
          ),
        );
      } else {
        rejectStart(
          new AxiError(`OAuth callback listener failed: ${error.message}`, "UNKNOWN"),
        );
      }
    });

    primary.listen(options.port, "127.0.0.1", () => {
      const address = primary.address();
      const port =
        address && typeof address === "object" ? address.port : options.port;

      // Best-effort ::1 twin for hosts where `localhost` resolves to IPv6
      // first; failure (no IPv6, port taken there) leaves IPv4 standing alone.
      const twin = createServer(handler);
      servers.push(twin);
      twin.on("error", () => {});
      twin.listen(port, "::1");

      resolveStart({ port, result, close: closeAll });
    });
  });
}

// ---------------------------------------------------------------------------
// Browser opening (injectable; the URL is always printed as the fallback)
// ---------------------------------------------------------------------------

export type BrowserOpener = (url: string) => Promise<boolean>;

let injectedOpener: BrowserOpener | null = null;

/** Override the browser opener for tests; `null` restores the platform default. */
export function setBrowserOpener(next: BrowserOpener | null): void {
  injectedOpener = next;
}

/**
 * cmd.exe re-parses its whole command line, so metacharacters in a URL argv
 * entry (`&` between query params above all) terminate the `start` command
 * and execute the rest as new commands. `^`-escape them (the same strategy
 * the `open` npm package uses) so the URL survives verbatim and nothing
 * env-influenced (e.g. ATLASSIAN_AXI_OAUTH_CLIENT_ID) reaches a command
 * position. `%` is deliberately NOT escaped: caret does not neutralise cmd's
 * %VAR% expansion, and a stray `^%` would corrupt the percent-encoding real
 * authorize URLs carry.
 */
export function escapeForCmdStart(url: string): string {
  return url.replace(/[&|^<>]/g, "^$&");
}

/**
 * Best-effort platform browser open (`open`/`xdg-open`/`start`). Returns false
 * instead of throwing — the login flow always prints the URL so a failed open
 * is never a dead-end.
 */
export async function openBrowser(url: string): Promise<boolean> {
  if (injectedOpener) {
    return injectedOpener(url);
  }
  const os = platform();
  const [command, args] =
    os === "darwin"
      ? ["open", [url]]
      : os === "win32"
        ? ["cmd", ["/c", "start", "", escapeForCmdStart(url)]]
        : ["xdg-open", [url]];
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args as string[], {
        stdio: "ignore",
        detached: true,
      });
      child.on("error", () => resolve(false));
      child.on("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}
