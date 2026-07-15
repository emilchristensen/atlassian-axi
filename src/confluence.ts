import { requireCredential, type AtlassianCredential } from "./config.js";
import { AxiError, confluenceHttpError } from "./errors.js";

/**
 * Confluence Cloud REST client — the direct-REST half of the CLI (no acli).
 * Two API versions by design (scout report §3.2 / risk R6): v2
 * (`/wiki/api/v2/...`) for page/space CRUD, v1 (`/wiki/rest/api/search`) for
 * CQL search, because v2 has no search endpoint. Basic auth with the unified
 * credential from config.ts (Atlassian API tokens are account-scoped).
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

/** Build the absolute request URL from the credential's site. */
function buildUrl(
  credential: AtlassianCredential,
  path: string,
  query?: Record<string, string | number | undefined>,
): string {
  const url = new URL(`https://${credential.site}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * Perform an authenticated Confluence REST call and parse the JSON response.
 * Resolves the unified credential itself (throws AUTH_REQUIRED when absent),
 * maps non-2xx statuses to typed AxiErrors, and returns `undefined` for
 * bodyless success responses (204 on DELETE).
 */
export async function confluenceJson<T = unknown>(
  path: string,
  options: ConfluenceRequestOptions = {},
): Promise<T> {
  const credential = await requireCredential();
  const url = buildUrl(credential, path, options.query);
  const basic = Buffer.from(
    `${credential.email}:${credential.apiToken}`,
  ).toString("base64");

  const headers: Record<string, string> = {
    Authorization: `Basic ${basic}`,
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

  let response: Response;
  try {
    response = await activeFetch()(url, init);
  } catch (error) {
    // Network-level failure; the message never carries the credential.
    const reason = error instanceof Error ? error.message : "request failed";
    throw new AxiError(
      `Confluence request failed: ${reason}`,
      "UNKNOWN",
      ["Check the network and the configured site (`atlassian-axi auth status`)"],
    );
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
