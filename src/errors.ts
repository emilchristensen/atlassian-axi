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
 * Ordered stderr/response patterns → AxiError. Empty in Phase 0; the Jira
 * (acli stderr) and Confluence (HTTP status body) halves populate this as they
 * land. `mapError` already falls back sensibly so callers can wire it now.
 */
const patterns: ErrorPattern[] = [];

function firstLine(raw: string): string {
  return raw.trim().split("\n")[0] ?? "";
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
