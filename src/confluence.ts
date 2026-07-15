import {
  requireAuth,
  type AtlassianCredential,
  type OAuthSession,
} from "./config.js";
import { AxiError, confluenceHttpError } from "./errors.js";
import { ensureFreshSession, refreshSession } from "./oauth.js";

/**
 * Confluence Cloud REST client — the direct-REST half of the CLI (no acli).
 * Two API versions by design (scout report §3.2 / risk R6): v2
 * (`/wiki/api/v2/...`) for page/space CRUD, v1 (`/wiki/rest/api/search`) for
 * CQL search, because v2 has no search endpoint.
 *
 * Two transports, resolved per call from the unified config:
 *  - OAuth (3LO): `https://api.atlassian.com/ex/confluence/{cloudId}` with a
 *    Bearer token, transparently refreshed on expiry and once on a 401
 *    (Atlassian rotates refresh tokens; oauth.ts persists the newest).
 *  - API token: `https://{site}` with Basic auth (agents/CI).
 */

/** Minimal fetch shape, injectable so tests never hit the network. */
export type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

let injectedFetch: FetchLike | null = null;

/**
 * Override the fetch implementation (tests inject a fake). Pass `null` to
 * restore the Node global fetch.
 */
export function setConfluenceFetch(next: FetchLike | null): void {
  injectedFetch = next;
}

function activeFetch(): FetchLike {
  return injectedFetch ?? (fetch as FetchLike);
}

const REQUEST_TIMEOUT_MS = 15_000;

export interface ConfluenceRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** Query parameters; undefined values are omitted. */
  query?: Record<string, string | number | undefined>;
  /** JSON-encoded into the request body. */
  body?: unknown;
}

/** Base URL for the active transport (OAuth gateway vs site-direct). */
function baseUrl(auth: TransportAuth): string {
  return auth.kind === "oauth"
    ? `https://api.atlassian.com/ex/confluence/${auth.session.cloudId}`
    : `https://${auth.credential.site}`;
}

function buildUrl(
  auth: TransportAuth,
  path: string,
  query?: Record<string, string | number | undefined>,
): string {
  const url = new URL(`${baseUrl(auth)}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

type TransportAuth =
  | { kind: "oauth"; session: OAuthSession }
  | { kind: "basic"; credential: AtlassianCredential };

function authorizationHeader(auth: TransportAuth): string {
  if (auth.kind === "oauth") {
    return `Bearer ${auth.session.accessToken}`;
  }
  const basic = Buffer.from(
    `${auth.credential.email}:${auth.credential.apiToken}`,
  ).toString("base64");
  return `Basic ${basic}`;
}

async function resolveTransportAuth(): Promise<TransportAuth> {
  const mode = await requireAuth();
  if (mode.mode === "oauth") {
    // Proactive refresh just before expiry so calls rarely see a 401 at all.
    return { kind: "oauth", session: await ensureFreshSession(mode.oauth) };
  }
  return { kind: "basic", credential: mode.credential };
}

async function performRequest(
  auth: TransportAuth,
  path: string,
  options: ConfluenceRequestOptions,
): Promise<Response> {
  const url = buildUrl(auth, path, options.query);
  const headers: Record<string, string> = {
    Authorization: authorizationHeader(auth),
    Accept: "application/json",
  };
  const init: RequestInit = {
    method: options.method ?? "GET",
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  try {
    return await activeFetch()(url, init);
  } catch (error) {
    // Network-level failure; the message never carries the credential.
    const reason = error instanceof Error ? error.message : "request failed";
    throw new AxiError(
      `Confluence request failed: ${reason}`,
      "UNKNOWN",
      ["Check the network and the configured site (`atlassian-axi auth status`)"],
    );
  }
}

/**
 * Perform an authenticated Confluence REST call and parse the JSON response.
 * Resolves the auth mode itself (throws AUTH_REQUIRED when absent), maps
 * non-2xx statuses to typed AxiErrors, and returns `undefined` for bodyless
 * success responses (204 on DELETE). In OAuth mode a 401 triggers exactly one
 * forced token refresh + retry before surfacing the error.
 */
export async function confluenceJson<T = unknown>(
  path: string,
  options: ConfluenceRequestOptions = {},
): Promise<T> {
  let auth = await resolveTransportAuth();
  let response = await performRequest(auth, path, options);

  if (response.status === 401 && auth.kind === "oauth") {
    // The proactive expiry check can miss a server-side revocation/clock skew;
    // refresh once (persisting the rotated refresh token) and retry.
    auth = { kind: "oauth", session: await refreshSession(auth.session) };
    response = await performRequest(auth, path, options);
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw confluenceHttpError(
      response.status,
      bodyText,
      response.headers.get("retry-after"),
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  if (text.trim() === "") {
    return undefined as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AxiError(
      `Unexpected Confluence response: ${text.slice(0, 200)}`,
      "UNKNOWN",
    );
  }
}
