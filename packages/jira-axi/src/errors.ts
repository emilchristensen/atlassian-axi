import {
  AxiError,
  exitCodeForError,
  firstLine,
  matchError,
  type ErrorCode,
  type ErrorPattern,
} from "@atlassian-axi/core";

// Re-export the SDK error currency so command modules import a single symbol.
export { AxiError, exitCodeForError };
export type { ErrorCode };

/**
 * Ordered acli stderr/stdout patterns -> typed AxiError. Captured from real
 * acli output (acli prefixes errors with "✗ Error: "); the generic
 * domain-agnostic matcher lives in @atlassian-axi/core, this is the
 * acli-backed Jira slice. Order matters: first match wins.
 */
const patterns: ErrorPattern[] = [
  {
    pattern: /unauthorized/i,
    code: "AUTH_REQUIRED",
    message: (_m, raw) => cleanAcliError(raw),
    suggestions: () => [
      "Run `acli jira auth login` to authenticate",
      "Run `acli jira auth status` to check the login state",
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
      "Run `acli jira auth status` to verify the login and site",
    ],
  },
  {
    // JQL parse failures ("failed to parse JQL query: field 'x' does not
    // exist...") must outrank NOT_FOUND: the "does not exist" fragment refers
    // to a JQL field, not a resource, and the fix is rewriting the query.
    pattern: /failed to parse jql|error in the jql/i,
    code: "VALIDATION_ERROR",
    message: (_m, raw) => cleanAcliError(raw),
    suggestions: () => [
      "Fix the JQL (check field names and quoting) and re-run",
      'Example: `jira-axi workitem search "project = TEAM AND status = Done"`',
    ],
  },
  {
    // Asking a kanban/simple board for sprints — acli prints the real reason
    // on stdout and a generic failure on stderr (verified live, acli v1.3.22).
    pattern: /does not support sprints/i,
    code: "VALIDATION_ERROR",
    message: (_m, raw) => cleanAcliError(raw),
    suggestions: () => [
      "Kanban/simple boards have no sprints — use `jira-axi board view <ID>` or `board list-projects <ID>`",
    ],
  },
  {
    // acli's agile/filter not-found phrasings, e.g. "We could not find the
    // sprint", "No project could be found with key 'X'." and "The selected
    // filter is not available to you, perhaps it has been deleted or had its
    // permissions changed."
    pattern: /not found|does not exist|no work item|no such|could not find|could be found|not available to you/i,
    code: "NOT_FOUND",
    message: (_m, raw) => cleanAcliError(raw),
    suggestions: () => [
      "Find the right key/ID with the matching list or search command (e.g. `jira-axi workitem search \"<JQL>\"`, `jira-axi board list`)",
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

/** Strip acli's "✗ Error: "/"✗ " decoration so messages stay clean and token-lean. */
function cleanAcliError(raw: string): string {
  return firstLine(raw)
    .replace(/^[✗x]?\s*Error:\s*/i, "")
    .replace(/^✗\s*/, "");
}

/** Map a raw acli stderr/stdout string to a typed AxiError. */
export function mapError(raw: string, exitCode = 1): AxiError {
  return matchError(
    raw,
    patterns,
    (r) => cleanAcliError(r) || `command failed with exit code ${exitCode}`,
  );
}

/** acli binary missing on PATH — surfaced when a Jira command shells out. */
export function acliNotInstalledError(): AxiError {
  return new AxiError(
    "acli is not installed — see https://developer.atlassian.com/cloud/acli/",
    "ACLI_NOT_INSTALLED",
    ["Install with `brew install acli`, then `acli --version` to verify"],
  );
}
