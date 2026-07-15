import type { FetchLike } from "../../src/confluence.js";

export interface FetchCall {
  url: URL;
  method: string;
  /** JSON-parsed request body, when one was sent. */
  body?: unknown;
  headers: Record<string, string>;
}

export interface FetchRoute {
  match: (call: FetchCall) => boolean;
  /** JSON payload (200) or a full status/body/headers description. */
  result:
    | unknown
    | { status: number; body?: unknown; headers?: Record<string, string> };
}

function isStatusResult(
  value: unknown,
): value is { status: number; body?: unknown; headers?: Record<string, string> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    typeof (value as { status: unknown }).status === "number"
  );
}

/**
 * Build a fake fetch from ordered routes. First matching route wins; an
 * unmatched request fails loudly so tests never silently pass on an
 * unexpected REST call (mirrors makeAcliFake).
 */
export function makeConfluenceFake(routes: FetchRoute[]) {
  const calls: FetchCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call: FetchCall = {
      url: new URL(url),
      method: init?.method ?? "GET",
      ...(init?.body !== undefined
        ? { body: JSON.parse(String(init.body)) }
        : {}),
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    for (const route of routes) {
      if (route.match(call)) {
        if (isStatusResult(route.result)) {
          const { status, body, headers } = route.result;
          return new Response(
            body === undefined ? null : JSON.stringify(body),
            { status, headers },
          );
        }
        return new Response(JSON.stringify(route.result), { status: 200 });
      }
    }
    throw new Error(`Unexpected Confluence request: ${call.method} ${url}`);
  };
  return { fetchImpl, calls };
}

/** Route matcher: method + pathname (+ optional query subset). */
export function onPath(
  method: string,
  pathname: string,
  query?: Record<string, string>,
): (call: FetchCall) => boolean {
  return (call) =>
    call.method === method &&
    call.url.pathname === pathname &&
    Object.entries(query ?? {}).every(
      ([key, value]) => call.url.searchParams.get(key) === value,
    );
}
