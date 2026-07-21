import { AxiError, exitCodeForError } from "axi-sdk-js";

/**
 * Error codes surfaced by the AXI Atlassian CLIs. Kept as one shared vocabulary
 * so the acli-backed Jira half and the direct-REST Confluence half map their
 * failures to the same codes. (ACLI_NOT_INSTALLED is only raised by jira-axi.)
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

export interface ErrorPattern {
  pattern: RegExp;
  code: ErrorCode;
  message: (match: RegExpMatchArray, raw: string) => string;
  suggestions?: (match: RegExpMatchArray) => string[];
}

export function firstLine(raw: string): string {
  return raw.trim().split("\n")[0] ?? "";
}

/**
 * Generic ordered-pattern matcher: first pattern whose regex matches `raw`
 * wins and becomes a typed AxiError; otherwise `fallback(raw)` (or the first
 * line) becomes an UNKNOWN error. Each CLI supplies its own pattern list.
 */
export function matchError(
  raw: string,
  patterns: readonly ErrorPattern[],
  fallback?: (raw: string) => string,
): AxiError {
  for (const { pattern, code, message, suggestions } of patterns) {
    const match = raw.match(pattern);
    if (match) {
      return new AxiError(message(match, raw), code, suggestions?.(match) ?? []);
    }
  }
  return new AxiError(
    fallback?.(raw) || firstLine(raw) || "command failed",
    "UNKNOWN",
  );
}
