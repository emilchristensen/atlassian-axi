import { AxiError, exitCodeForError } from "axi-sdk-js";

/**
 * Error codes surfaced by atlassian-axi. Kept in one place so the acli-backed
 * Jira half and the direct-REST Confluence half map their failures to the same
 * vocabulary. Extended as later phases add real error mapping.
 */
export type ErrorCode =
  | "NOT_FOUND"
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "ACLI_NOT_INSTALLED"
  | "UNKNOWN";

// Re-export the SDK error currency so command modules import a single symbol.
export { AxiError, exitCodeForError };

interface ErrorPattern {
  pattern: RegExp;
  code: ErrorCode;
  message: (match: RegExpMatchArray, raw: string) => string;
  suggestions?: (match: RegExpMatchArray) => string[];
}

/**
 * Ordered stderr/response patterns → AxiError. Populated from real acli
 * stderr where observed (acli prefixes errors with "✗ Error: "); the
 * Confluence half (HTTP status bodies) extends this in Phase 3. Order
 * matters: first match wins.
 */
const patterns: ErrorPattern[] = [
  {
    pattern: /unauthorized/i,
    code: "AUTH_REQUIRED",
    message: (_m, raw) => cleanAcliError(raw),
    suggestions: () => [
      "Run `atlassian-axi auth login --site <site> --email <email>` (token via stdin)",
      "Run `atlassian-axi auth status` to check both halves",
    ],
  },
  {
    pattern: /rate limit/i,
    code: "RATE_LIMITED",
    message: (_m, raw) => cleanAcliError(raw),
    suggestions: () => ["Wait a moment and re-run the command"],
  },
  {
    pattern: /forbidden|permission denied|not permitted|does not have permission/i,
    code: "FORBIDDEN",
    message: (_m, raw) => cleanAcliError(raw),
    suggestions: () => [
      "Run `atlassian-axi auth status` to verify the credential and site",
    ],
  },
  {
    // acli's agile/filter not-found phrasings, e.g. "We could not find the
    // sprint" and "The selected filter is not available to you, perhaps it
    // has been deleted or had its permissions changed."
    pattern: /not found|does not exist|no work item|no such|could not find|not available to you/i,
    code: "NOT_FOUND",
    message: (_m, raw) => cleanAcliError(raw),
    suggestions: () => [
      "Find the right key/ID with the matching list or search command (e.g. `jira workitem search \"<JQL>\"`, `jira board list`)",
    ],
  },
  {
    pattern: /unbounded jql/i,
    code: "VALIDATION_ERROR",
    message: (_m, raw) => cleanAcliError(raw),
    suggestions: () => [
      "Add a restriction (project, assignee, status, or an updated >= -30d window) to the JQL",
    ],
  },
  {
    pattern:
      /invalid|bad request|cannot be parsed|error in the jql|malformed|not allowed/i,
    code: "VALIDATION_ERROR",
    message: (_m, raw) => cleanAcliError(raw),
  },
];

function firstLine(raw: string): string {
  return raw.trim().split("\n")[0] ?? "";
}

/** Strip acli's "✗ Error: "/"✗ " decoration so messages stay clean and token-lean. */
function cleanAcliError(raw: string): string {
  return firstLine(raw)
    .replace(/^[✗x]?\s*Error:\s*/i, "")
    .replace(/^✗\s*/, "");
}

/** Map a raw error string (acli stderr or REST body) to a typed AxiError. */
export function mapError(raw: string, exitCode = 1): AxiError {
  for (const { pattern, code, message, suggestions } of patterns) {
    const match = raw.match(pattern);
    if (match) {
      return new AxiError(message(match, raw), code, suggestions?.(match) ?? []);
    }
  }
  return new AxiError(
    firstLine(raw) || `command failed with exit code ${exitCode}`,
    "UNKNOWN",
  );
}

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
      );
    case 401:
      return new AxiError(
        detail || "Confluence authentication failed (401)",
        "AUTH_REQUIRED",
        [
          "Run `atlassian-axi auth login --site <site> --email <email>` (token via stdin)",
          "Run `atlassian-axi auth status` to check both halves",
        ],
      );
    case 403:
      return new AxiError(
        detail || "Confluence denied access (403)",
        "FORBIDDEN",
        ["Run `atlassian-axi auth status` to verify the credential and site"],
      );
    case 404:
      return new AxiError(detail || "Not found (404)", "NOT_FOUND", [
        'Run `atlassian-axi confluence search "<CQL>"` to find the right page id',
      ]);
    case 409:
      return new AxiError(
        detail || "Version conflict (409): the page changed since it was read",
        "VALIDATION_ERROR",
        [
          "Re-run the command — it re-reads the current version before writing",
        ],
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
      return firstLine(parsed.message);
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

/** acli binary missing on PATH — surfaced when the Jira half shells out. */
export function acliNotInstalledError(): AxiError {
  return new AxiError(
    "acli is not installed — see https://developer.atlassian.com/cloud/acli/",
    "ACLI_NOT_INSTALLED",
    ["Install with `brew install acli`, then `acli --version` to verify"],
  );
}
