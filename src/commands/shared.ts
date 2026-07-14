import { takeBoolFlag, takeFlag } from "../args.js";
import { AxiError } from "../errors.js";

/**
 * Domain-agnostic subcommand plumbing shared by the Jira and Confluence
 * command families: flags-before-positional parsing and --limit validation.
 */

export interface ParsedFlags {
  /** Value flags, keyed by flag name (e.g. "--limit"). */
  values: Record<string, string | undefined>;
  /** Boolean flags, keyed by flag name (e.g. "--full"). */
  bools: Record<string, boolean>;
  /** True when a standalone --help remained after flag consumption. */
  help: boolean;
  /** The first remaining positional (flags and their values already removed). */
  positional: string | undefined;
}

/**
 * Consume a subcommand's known flags from `args` (mutating it), THEN read the
 * first remaining positional. Consuming flag values first is what keeps
 * `transition --to Done TEAM-1` from parsing "Done" as the key, and keeps a
 * flag value that happens to be "--help" from hijacking the subcommand into
 * help output (body flags must be taken by the caller before calling this).
 */
export function parseFlags(
  args: string[],
  spec: { values?: string[]; bools?: string[] },
): ParsedFlags {
  const values: Record<string, string | undefined> = {};
  for (const flag of spec.values ?? []) {
    values[flag] = takeFlag(args, flag);
  }
  const bools: Record<string, boolean> = {};
  for (const flag of spec.bools ?? []) {
    bools[flag] = takeBoolFlag(args, flag);
  }
  const help = takeBoolFlag(args, "--help");
  const positional = args.slice(1).find((a) => !a.startsWith("--"));
  return { values, bools, help, positional };
}

const DEFAULT_LIMIT = 30;

/** Parse a --limit value; positive integer or a VALIDATION_ERROR. */
export function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n <= 0) {
    throw new AxiError(`Invalid --limit: ${raw}`, "VALIDATION_ERROR");
  }
  return n;
}
