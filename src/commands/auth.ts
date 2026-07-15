import { acliRaw, acliExec, acliInstalled } from "../acli.js";
import { takeBoolFlag, takeFlag } from "../args.js";
import {
  type AtlassianCredential,
  type OAuthSession,
  clearCredential,
  isInteractiveTTY,
  normalizeSite,
  readOAuthSession,
  readTokenFromStdin,
  resolveAuthMode,
  resolveCredential,
  resolveOAuthClientSecret,
  sanitizeToken,
  saveCredential,
  saveOAuthSession,
} from "../config.js";
import { AxiError } from "../errors.js";
import {
  OAUTH_CALLBACK_PORT,
  OAUTH_REDIRECT_URI,
  buildAuthorizeUrl,
  ensureFreshSession,
  exchangeAuthorizationCode,
  fetchAccessibleResources,
  generateState,
  oauthClientId,
  openBrowser,
  startCallbackServer,
  type AccessibleResource,
} from "../oauth.js";
import { promptHidden, promptSelect } from "../prompt.js";
import { renderHelp, renderOutput } from "../toon.js";

export const AUTH_HELP = `usage: atlassian-axi auth <login|status|logout> [flags]
Manage Atlassian auth. Two modes:
  oauth      browser login (the default \`auth login\`) — Bearer tokens against
             api.atlassian.com, auto-refreshed; needs an interactive terminal.
  api-token  \`auth login --token\` — site+email+API token for agents/CI; the
             token is read from stdin only, never as an argument.

login            OAuth browser login. Opens auth.atlassian.com, catches the
                 http://localhost:8765/callback redirect, stores tokens + cloudId
                 in the 0600 config. --site <site> pre-selects among multiple sites.
                 Client secret: ATLASSIAN_AXI_OAUTH_CLIENT_SECRET env, or prompted
                 once and stored in the 0600 config.
login --token    API-token login (agents/CI; no browser).
                 --site <site>   e.g. mysite.atlassian.net (falls back to ATLASSIAN_SITE / stored)
                 --email <email> account email (falls back to ATLASSIAN_EMAIL / stored)
                 token via stdin: echo -n "<token>" | atlassian-axi auth login --token --site s --email e
status           Active mode, token expiry, and both halves (acli + Confluence REST).
logout           Clear OAuth tokens + API credential/keychain, and log acli out.

Resolution order: ATLASSIAN_API_TOKEN env > OAuth session > stored API token.
The Jira half rides acli's own credential: \`auth login --token\` bootstraps it;
the OAuth flow cannot (acli needs an API token), so status reports it separately.

examples:
  atlassian-axi auth login
  echo -n "$TOKEN" | atlassian-axi auth login --token --site acme.atlassian.net --email me@acme.com
  atlassian-axi auth status
  atlassian-axi auth logout
`;

const REST_SPACES_PATH = "/wiki/api/v2/spaces?limit=1";
const JIRA_MYSELF_PATH = "/rest/api/3/myself";
const PING_TIMEOUT_MS = 15_000;

export async function authCommand(args: string[]): Promise<string> {
  const action = args[0];
  const rest = args.slice(1);
  switch (action) {
    case "login":
      return authLogin(rest);
    case "status":
      return authStatus();
    case "logout":
      return authLogout();
    default:
      throw new AxiError(
        action ? `Unknown auth action: ${action}` : "Missing auth action",
        "VALIDATION_ERROR",
        ["Run `atlassian-axi auth <login|status|logout>`"],
      );
  }
}

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------

async function authLogin(args: string[]): Promise<string> {
  if (takeBoolFlag(args, "--token")) {
    return tokenLogin(args);
  }
  return oauthLogin(args);
}

// --- OAuth (3LO) browser flow -----------------------------------------------

async function oauthLogin(args: string[]): Promise<string> {
  // Fail fast for agents/CI before any listener/browser/prompt work: a
  // headless invocation must never hang waiting on a browser.
  if (!isInteractiveTTY()) {
    throw new AxiError(
      "OAuth browser login needs an interactive terminal (stdin/stdout is not a TTY)",
      "VALIDATION_ERROR",
      [
        `Agents/CI: echo -n "<token>" | atlassian-axi auth login --token --site <site> --email <email>`,
        "Or set ATLASSIAN_SITE / ATLASSIAN_EMAIL / ATLASSIAN_API_TOKEN",
      ],
    );
  }

  const siteFlag = normalizeSite(takeFlag(args, "--site"));
  const clientId = oauthClientId();
  const existingSession = readOAuthSession();
  const resolvedSecret = resolveOAuthClientSecret(existingSession);
  let clientSecret: string;
  let secretSource: "env" | "config" | "prompt";
  if (resolvedSecret) {
    clientSecret = resolvedSecret.secret;
    secretSource = resolvedSecret.source;
  } else {
    process.stderr.write(
      "First OAuth login: the app's client secret is needed once (stored in the 0600 config).\n",
    );
    // Same quote-wrapping paste hazard as the API token — sanitize before use
    // so a mangled secret never reaches the token endpoint or the store.
    clientSecret = sanitizeToken(await promptHidden("OAuth client secret"));
    secretSource = "prompt";
    if (clientSecret === "") {
      throw new AxiError(
        "Empty client secret after stripping quotes — nothing was stored",
        "VALIDATION_ERROR",
        ["Re-run `atlassian-axi auth login` and paste the raw secret value"],
      );
    }
  }

  const state = generateState();
  const server = await startCallbackServer({
    port: OAUTH_CALLBACK_PORT,
    expectedState: state,
  });
  let code: string;
  try {
    const authorizeUrl = buildAuthorizeUrl({ clientId, state });
    const opened = await openBrowser(authorizeUrl);
    process.stderr.write(
      `${opened ? "Opened the browser to" : "Could not open a browser — visit"}:\n  ${authorizeUrl}\n` +
        `Waiting for the callback on ${OAUTH_REDIRECT_URI} ...\n`,
    );
    ({ code } = await server.result);
  } finally {
    server.close();
  }

  const tokens = await exchangeAuthorizationCode({ clientId, clientSecret, code });
  const resources = await fetchAccessibleResources(tokens.accessToken);
  const resource = await pickResource(resources, siteFlag);
  const site = normalizeSite(resource.url) as string;

  const session: OAuthSession = {
    clientId,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    cloudId: resource.id,
    site,
    scopes: tokens.scopes,
    // Keep the secret out of the store when env supplies it; persist it when
    // it was prompted (first login) or already stored (re-login).
    ...(secretSource === "env" ? {} : { clientSecret }),
  };
  saveOAuthSession(session);

  const acli = await acliStateFor(site);
  return renderOutput([
    [
      "auth:",
      `  action: login`,
      `  mode: oauth`,
      `  site: ${site}`,
      `  cloud-id: ${resource.id}`,
      `  token-expires: ${expiryPhrase(session.expiresAt)}`,
      `  secret-source: ${secretSource}`,
      `  acli: ${acliOAuthNote(acli)}`,
    ].join("\n"),
    renderHelp(["Verify end-to-end with `atlassian-axi auth status`"]),
  ]);
}

/** Choose the target site among the token's accessible resources. */
async function pickResource(
  resources: AccessibleResource[],
  siteFlag: string | undefined,
): Promise<AccessibleResource> {
  if (resources.length === 0) {
    throw new AxiError(
      "The OAuth token has no accessible Atlassian sites",
      "FORBIDDEN",
      ["Grant the app access to a site at https://id.atlassian.com and re-run `atlassian-axi auth login`"],
    );
  }
  if (siteFlag) {
    const match = resources.find((r) => normalizeSite(r.url) === siteFlag);
    if (!match) {
      const available = resources
        .map((r) => normalizeSite(r.url))
        .filter(Boolean)
        .join(", ");
      throw new AxiError(
        `--site ${siteFlag} is not among the token's accessible sites (${available})`,
        "VALIDATION_ERROR",
        ["Re-run with one of the listed sites, or without --site to pick interactively"],
      );
    }
    return match;
  }
  if (resources.length === 1) {
    return resources[0] as AccessibleResource;
  }
  const index = await promptSelect(
    "Multiple Atlassian sites are accessible — pick one:",
    resources.map((r) => `${r.name} (${normalizeSite(r.url)})`),
  );
  return resources[index] as AccessibleResource;
}

// --- API-token flow (agents/CI; formerly the only flow) ----------------------

async function tokenLogin(args: string[]): Promise<string> {
  const siteFlag = takeFlag(args, "--site");
  const emailFlag = takeFlag(args, "--email");

  // Flags win, then fall back to any already-resolved (env/stored) values so a
  // re-login only needs to supply what changed.
  const resolved = await resolveCredential();
  const site = normalizeSite(siteFlag ?? resolved.site);
  const email = (emailFlag ?? resolved.email)?.trim();

  if (!site || !email) {
    const missing = [!site ? "--site" : null, !email ? "--email" : null].filter(
      Boolean,
    );
    throw new AxiError(
      `Missing required credential fields: ${missing.join(", ")}`,
      "VALIDATION_ERROR",
      [
        `echo -n "<token>" | atlassian-axi auth login --token --site <site> --email <email>`,
      ],
    );
  }

  // Token is stdin-only; TTY throws before we touch anything else.
  const apiToken = await readTokenFromStdin();
  const credential: AtlassianCredential = { site, email, apiToken };

  // Validate BEFORE persisting so a mangled paste never overwrites a
  // previously good stored credential. Without this ping, a bad token slips
  // through whenever acli is already logged in (bootstrap is status-gated and
  // never exercises the new token).
  const confluenceLine = await validateTokenForLogin(credential);

  const { tokenStore } = await saveCredential(credential);
  const bootstrap = await bootstrapAcli(credential);

  return renderOutput([
    [
      "auth:",
      `  action: login`,
      `  mode: api-token`,
      `  site: ${site}`,
      `  email: ${email}`,
      `  token-store: ${tokenStore}`,
      `  confluence: ${confluenceLine}`,
      `  acli: ${bootstrap}`,
    ].join("\n"),
    renderHelp(["Verify end-to-end with `atlassian-axi auth status`"]),
  ]);
}

/**
 * Login-time credential check with an explicit failure taxonomy. Returns the
 * `confluence:` line for the login output, or throws AUTH_REQUIRED (before
 * anything is persisted) when the token is demonstrably rejected.
 *
 * - Network failure (status 0): the token may be fine — degrade gracefully
 *   like the acli-not-installed path and let login proceed with a warning.
 * - Non-200 from Confluence: ambiguous. Confluence v2 answers a rejected
 *   credential with 404 (live-verified), which is also what a Jira-only site
 *   without the Confluence product returns. Disambiguate with a Jira ping —
 *   Jira answers a rejected Basic credential with 401 (live-verified): Jira
 *   200 means the token is good and only Confluence is unavailable (warn);
 *   Jira non-200 means the token itself is rejected (hard fail).
 */
async function validateTokenForLogin(
  credential: AtlassianCredential,
): Promise<string> {
  const rest = await confluencePing(credential);
  if (rest.ok) {
    return "200 ok";
  }
  if (rest.status === 0) {
    return `unreachable (${rest.detail}) — token not verified; check with \`atlassian-axi auth status\` once online`;
  }

  const jira = await basicPing(credential, JIRA_MYSELF_PATH);
  if (jira.ok) {
    return `${rest.status} ${rest.detail} — token verified against Jira; the site may not have Confluence (or this account lacks Confluence access)`;
  }
  if (jira.status === 0) {
    return `${rest.status} ${rest.detail} — network dropped before the token could be verified; check with \`atlassian-axi auth status\` once online`;
  }
  throw new AxiError(
    `The token was rejected (Confluence ${rest.status}, Jira ${jira.status}) — nothing was saved. Confluence answers rejected credentials with 404/403, so the 404 does not mean the site lacks Confluence.`,
    "AUTH_REQUIRED",
    [
      "Check the token: copy the raw value (no quotes) and re-run `atlassian-axi auth login --token`",
      "Check the site host with `atlassian-axi auth status`",
    ],
  );
}

/**
 * Bootstrap acli from our credential, status-gated so it is idempotent: only
 * log acli in when it is not already authenticated to the configured site.
 * acli's own store stays a derived cache of our source of truth.
 */
async function bootstrapAcli(credential: AtlassianCredential): Promise<string> {
  if (!(await acliInstalled())) {
    return "not installed (Jira half unavailable until acli is installed)";
  }
  if (await acliLoggedIntoSite(credential.site)) {
    return `already logged in to ${credential.site}`;
  }
  await acliExec(
    [
      "jira",
      "auth",
      "login",
      "--site",
      credential.site,
      "--email",
      credential.email,
      "--token",
    ],
    credential.apiToken,
  );
  return `logged in to ${credential.site}`;
}

/** True when acli reports an authenticated session for the given site. */
async function acliLoggedIntoSite(site: string): Promise<boolean> {
  const result = await acliRaw(["jira", "auth", "status"]);
  if (result.exitCode !== 0) {
    return false;
  }
  const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return output.includes(site.toLowerCase());
}

type AcliState = "not installed" | "logged in" | "not logged in";

async function acliStateFor(site: string): Promise<AcliState> {
  if (!(await acliInstalled())) {
    return "not installed";
  }
  return (await acliLoggedIntoSite(site)) ? "logged in" : "not logged in";
}

/** Honest acli line for OAuth contexts: the OAuth token cannot bootstrap acli. */
function acliOAuthNote(state: AcliState): string {
  switch (state) {
    case "logged in":
      return "logged in (separate acli credential — Jira half ready)";
    case "not logged in":
      return "not logged in — Jira half needs `auth login --token` (or `acli jira auth login`)";
    case "not installed":
      return "not installed (Jira half unavailable until acli is installed)";
  }
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

async function authStatus(): Promise<string> {
  const mode = await resolveAuthMode();
  if (mode.mode === "none") {
    throw new AxiError(
      `Not authenticated (missing: ${mode.missing.join(", ")})`,
      "AUTH_REQUIRED",
      [
        "Run `atlassian-axi auth login` for the OAuth browser flow (interactive terminals)",
        "Or `echo -n \"<token>\" | atlassian-axi auth login --token --site <site> --email <email>` (agents/CI)",
      ],
    );
  }
  return mode.mode === "oauth"
    ? oauthStatus(mode.oauth)
    : tokenStatus(mode.credential, mode.sources.apiToken ?? "config");
}

async function oauthStatus(session: OAuthSession): Promise<string> {
  const acliState = await acliStateFor(session.site);

  // Refresh if expired so status exercises the same path real calls use; a
  // failed refresh is the honest "your session is dead" signal.
  let active = session;
  let tokenLine: string;
  let refreshFailed: string | null = null;
  try {
    active = await ensureFreshSession(session);
    tokenLine = `valid (expires ${expiryPhrase(active.expiresAt)})`;
  } catch (error) {
    refreshFailed = error instanceof Error ? error.message : "refresh failed";
    tokenLine = `expired — refresh failed: ${refreshFailed}`;
  }

  const rest = refreshFailed
    ? { ok: false, status: 0, detail: "skipped (token refresh failed)" }
    : await restPing({
        url: `https://api.atlassian.com/ex/confluence/${active.cloudId}${REST_SPACES_PATH}`,
        authorization: `Bearer ${active.accessToken}`,
      });

  // The Jira half runs on acli's own credential in OAuth mode, so its state is
  // reported but does not gate ok/degraded.
  const ok = rest.ok;
  const detail = [
    "auth:",
    `  status: ${ok ? "ok" : "degraded"}`,
    `  mode: oauth`,
    `  site: ${active.site}`,
    `  cloud-id: ${active.cloudId}`,
    `  token: ${tokenLine}`,
    `  acli: ${acliOAuthNote(acliState)}`,
    `  confluence: ${rest.ok ? "200 ok" : `${rest.status} ${rest.detail}`}`,
  ].join("\n");

  if (!ok) {
    throw new AxiError(`auth check failed\n${detail}`, "AUTH_REQUIRED", [
      refreshFailed
        ? "Re-run `atlassian-axi auth login` to start a fresh OAuth session"
        : "Check the OAuth session — Confluence REST did not return 200",
    ]);
  }
  return renderOutput([detail]);
}

async function tokenStatus(
  credential: AtlassianCredential,
  tokenSource: string,
): Promise<string> {
  // acli (Jira) half.
  let acliState: string;
  if (!(await acliInstalled())) {
    acliState = "not installed";
  } else if (await acliLoggedIntoSite(credential.site)) {
    acliState = "logged in";
  } else {
    acliState = "not logged in";
  }

  // Confluence REST half — a cheap authenticated call.
  const rest = await confluencePing(credential);

  const ok = acliState === "logged in" && rest.ok;
  const detail = [
    "auth:",
    `  status: ${ok ? "ok" : "degraded"}`,
    `  mode: api-token`,
    `  site: ${credential.site}`,
    `  email: ${credential.email}`,
    `  token: present (${tokenSource})`,
    `  acli: ${acliState}`,
    `  confluence: ${rest.ok ? "200 ok" : `${rest.status} ${rest.detail}`}`,
  ].join("\n");

  if (!ok) {
    if (acliState === "not installed") {
      throw new AxiError(
        `acli is not installed — see https://developer.atlassian.com/cloud/acli/\n${detail}`,
        "ACLI_NOT_INSTALLED",
        ["Install with `brew install acli`, then `acli --version` to verify"],
      );
    }
    // "Likely invalid" is only fair when Confluence actually rejected the
    // credential; status 0 (network) and 5xx are not the token's fault.
    const restHint =
      rest.status === 401 || rest.status === 403 || rest.status === 404
        ? "The token is likely invalid — Confluence answers rejected credentials with 404/403; copy the raw token (no quotes) and re-run `atlassian-axi auth login --token`"
        : "Confluence REST did not return 200 — check the network and the site host, then re-run `atlassian-axi auth status`";
    throw new AxiError(`auth check failed\n${detail}`, "AUTH_REQUIRED", [
      acliState !== "logged in"
        ? "Re-run `atlassian-axi auth login --token` to bootstrap acli"
        : restHint,
    ]);
  }

  return renderOutput([detail]);
}

interface PingResult {
  ok: boolean;
  status: number;
  detail: string;
}

function basicAuthorization(credential: AtlassianCredential): string {
  const basic = Buffer.from(
    `${credential.email}:${credential.apiToken}`,
  ).toString("base64");
  return `Basic ${basic}`;
}

/**
 * GET a REST URL with the given Authorization (Basic or Bearer); `status: 0`
 * means the request never got an HTTP response (network failure or timeout).
 * Never throws.
 */
async function restPing(request: {
  url: string;
  authorization: string;
}): Promise<PingResult> {
  try {
    const response = await fetch(request.url, {
      headers: {
        Authorization: request.authorization,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    return {
      ok: response.status === 200,
      status: response.status,
      detail: response.status === 200 ? "ok" : response.statusText,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      detail: error instanceof Error ? error.message : "request failed",
    };
  }
}

/** GET a site-relative REST path with Basic auth (the api-token half). */
function basicPing(
  credential: AtlassianCredential,
  path: string,
): Promise<PingResult> {
  return restPing({
    url: `https://${credential.site}${path}`,
    authorization: basicAuthorization(credential),
  });
}

/** GET /wiki/api/v2/spaces?limit=1 with Basic auth; 200 means the token works. */
function confluencePing(credential: AtlassianCredential): Promise<PingResult> {
  return basicPing(credential, REST_SPACES_PATH);
}

/** Human phrase for a token expiry timestamp (absolute-safe, minute granularity). */
function expiryPhrase(expiresAt: number): string {
  const deltaMs = expiresAt - Date.now();
  if (deltaMs <= 0) {
    return "expired (auto-refreshes on next call)";
  }
  const minutes = Math.max(1, Math.round(deltaMs / 60_000));
  return `in ~${minutes}m`;
}

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------

async function authLogout(): Promise<string> {
  const hadOAuth = readOAuthSession() !== null;
  await clearCredential();

  let acliState = "skipped (not installed)";
  if (await acliInstalled()) {
    const result = await acliRaw(["jira", "auth", "logout"]);
    acliState =
      result.exitCode === 0
        ? "logged out"
        : `failed (exit ${result.exitCode}): ${result.stderr.trim() || result.stdout.trim() || "unknown error"}`;
  }

  return renderOutput([
    [
      "auth:",
      `  action: logout`,
      `  credential: cleared`,
      `  oauth: ${hadOAuth ? "cleared" : "none stored"}`,
      `  acli: ${acliState}`,
    ].join("\n"),
  ]);
}
