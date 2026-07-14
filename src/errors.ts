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
    pattern: /not found|does not exist|no work item|no such/i,
    code: "NOT_FOUND",
    message: (_m, raw) => cleanAcliError(raw),
    suggestions: () => [
      'Run `atlassian-axi jira workitem search "<JQL>"` to find the right key',
    ],
  },
  {
    pattern: /invalid|bad request|cannot be parsed|error in the jql|malformed/i,
    code: "VALIDATION_ERROR",
    message: (_m, raw) => cleanAcliError(raw),
  },
];

function firstLine(raw: string): string {
  return raw.trim().split("\n")[0] ?? "";
}

/** Strip acli's "✗ Error: " decoration so messages stay clean and token-lean. */
function cleanAcliError(raw: string): string {
  return firstLine(raw).replace(/^[✗x]?\s*Error:\s*/i, "");
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

/** acli binary missing on PATH — surfaced when the Jira half shells out. */
export function acliNotInstalledError(): AxiError {
  return new AxiError(
    "acli is not installed — see https://developer.atlassian.com/cloud/acli/",
    "ACLI_NOT_INSTALLED",
    ["Install with `brew install acli`, then `acli --version` to verify"],
  );
}
