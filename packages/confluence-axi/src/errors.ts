import {
  AxiError,
  exitCodeForError,
  firstLine,
  type ErrorCode,
} from "@atlassian-axi/core";

// Re-export the SDK error currency so command modules import a single symbol.
export { AxiError, exitCodeForError };
export type { ErrorCode };

/**
 * Map a Confluence REST failure (HTTP status + response body) to a typed
 * AxiError. The message probe tolerates both error shapes Atlassian ships:
 * v2 `{errors: [{title, detail}]}` and v1 `{message}`.
 */
export function confluenceHttpError(
  status: number,
  bodyText: string,
  retryAfter?: string | null,
): AxiError {
  const detail = confluenceErrorDetail(bodyText);
  switch (status) {
    case 400:
      return new AxiError(
        detail || "Confluence rejected the request (400)",
        "VALIDATION_ERROR",
        /cql/i.test(detail)
          ? [
              'Check the CQL syntax — e.g. `confluence-axi search "space = ENG AND type = page"`',
            ]
          : [],
      );
    case 401:
      return new AxiError(
        detail || "Confluence authentication failed (401)",
        "AUTH_REQUIRED",
        [
          "Run `confluence-axi auth login` for the OAuth browser flow, or `confluence-axi auth login --token` (site + email + API token via stdin)",
          "Run `confluence-axi auth status` to check the credential",
        ],
      );
    case 403:
      return new AxiError(
        detail || "Confluence denied access (403)",
        "FORBIDDEN",
        ["Run `confluence-axi auth status` to verify the credential and site"],
      );
    case 404:
      // Confluence v2 also answers rejected credentials with 404 (anonymous
      // anti-enumeration), so a 404 is ambiguous between "wrong id" and
      // "bad token" — verified live 2026-07-15.
      return new AxiError(detail || "Not found (404)", "NOT_FOUND", [
        'Run `confluence-axi search "<CQL>"` to find the right page id',
        "A 404 can also mean the credential was rejected — run `confluence-axi auth status` to check it",
      ]);
    case 409:
      return new AxiError(
        detail || "Version conflict (409): the page changed since it was read",
        "VALIDATION_ERROR",
        ["Re-run the command — it re-reads the current version before writing"],
      );
    case 429:
      // Retry-After may be delta-seconds or an HTTP-date (RFC 9110); only the
      // numeric form reads sensibly as "Wait Ns".
      return new AxiError(
        detail || "Confluence rate limit hit (429)",
        "RATE_LIMITED",
        [
          retryAfter && /^\d+$/.test(retryAfter.trim())
            ? `Wait ${retryAfter.trim()}s (Retry-After) and re-run the command`
            : "Wait a moment and re-run the command",
        ],
      );
    default:
      return new AxiError(
        detail || `Confluence request failed with HTTP ${status}`,
        "UNKNOWN",
      );
  }
}

/** Best-effort human message out of a Confluence error response body. */
function confluenceErrorDetail(bodyText: string): string {
  if (!bodyText) return "";
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    if (typeof parsed.message === "string" && parsed.message) {
      return stripJavaExceptionPrefix(firstLine(parsed.message));
    }
    const errors = parsed.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0] as Record<string, unknown>;
      const title = first?.title ?? first?.detail;
      if (typeof title === "string" && title) {
        return firstLine(title);
      }
    }
  } catch {
    // Non-JSON body (HTML error page etc.) — fall through to the first line.
    return firstLine(bodyText).slice(0, 200);
  }
  return "";
}

/**
 * Confluence v1 prefixes some error messages with the throwing Java class
 * ("com.atlassian...BadRequestException: Could not parse cql : ..." —
 * verified live 2026-07-19); the class name is noise for a CLI user.
 */
function stripJavaExceptionPrefix(message: string): string {
  return message.replace(
    /^(?:[a-z][\w$]*\.)+[A-Z][\w$]*(?:Exception|Error):\s*/,
    "",
  );
}
