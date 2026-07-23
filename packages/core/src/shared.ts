import { takeBoolFlag, takeFlag } from "./args.js";
import { AxiError } from "./errors.js";
import { closestCommand } from "./suggestions.js";

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

/** What a subcommand accepts, as handed to parseFlags. */
export interface FlagSpec {
  /** Value flags to consume, e.g. `["--limit"]`. */
  values?: string[];
  /** Boolean flags to consume, e.g. `["--full"]`. */
  bools?: string[];
  /**
   * Flags the caller already removed from `args` before calling (takeBody's
   * body flags, the cli's global `--site`). parseFlags cannot see them, but
   * the command does accept them, so they still belong in the flag list an
   * unknown-flag error suggests.
   */
  consumed?: string[];
}

/**
 * Take a value flag, refusing both a missing value and a value that is itself
 * a flag. A vanished value must not silently turn a mutation into a read, and
 * a swallowed sibling flag must not produce a garbage write (`--add --remove`
 * used to POST a label literally named "--remove"). Shared so hand-rolled
 * parsers (auth login) get the same guards as parseFlags.
 */
export function takeValueFlag(
  args: string[],
  flag: string,
): string | undefined {
  const present =
    args.includes(flag) || args.some((a) => a.startsWith(`${flag}=`));
  const value = takeFlag(args, flag);
  if (present && value === undefined) {
    throw new AxiError(`${flag} requires a value`, "VALIDATION_ERROR", [
      "Run the command with --help to see the supported flags",
    ]);
  }
  if (value !== undefined && value.startsWith("--")) {
    throw new AxiError(
      `${flag} requires a value (got the flag ${value} instead)`,
      "VALIDATION_ERROR",
      [`Pass an explicit value: ${flag} <value>`],
    );
  }
  return value;
}

/**
 * Consume a subcommand's known flags from `args` (mutating it), THEN read the
 * first remaining positional. Consuming flag values first is what keeps
 * `transition --to Done TEAM-1` from parsing "Done" as the key, and keeps a
 * flag value that happens to be "--help" from hijacking the subcommand into
 * help output (body flags must be taken by the caller before calling this).
 *
 * Leftover `--*` tokens are unknown (or typo'd) flags and are rejected: a
 * silently ignored `--formt storage` would otherwise turn its value into the
 * positional and discard the real one (review finding).
 */
export function parseFlags(args: string[], spec: FlagSpec): ParsedFlags {
  const values: Record<string, string | undefined> = {};
  for (const flag of spec.values ?? []) {
    values[flag] = takeValueFlag(args, flag);
  }
  const bools: Record<string, boolean> = {};
  for (const flag of spec.bools ?? []) {
    bools[flag] = takeBoolFlag(args, flag);
  }
  const help = takeBoolFlag(args, "--help");
  const unknown = args.slice(1).find((a) => a.startsWith("--"));
  if (unknown !== undefined && !help) {
    throw new AxiError(`Unknown flag: ${unknown}`, "VALIDATION_ERROR", [
      ...supportedFlagsSuggestions(spec),
      "Run the command with --help to see the supported flags",
    ]);
  }
  const positional = args.slice(1).find((a) => !a.startsWith("--"));
  return { values, bools, help, positional };
}

/**
 * Enumerate a spec's accepted flags for an error's suggestions, so a typo'd
 * flag is answered inline instead of costing the agent a second `--help`
 * round-trip. Flags the caller consumed before parseFlags ran are listed too,
 * or the error would claim a command takes no flags while `--body` is
 * required. `--help` is always accepted (parseFlags consumes it), so it is
 * listed even for a command with no flags of its own.
 */
function supportedFlagsSuggestions(spec: FlagSpec): string[] {
  const flags = [
    ...new Set([
      ...(spec.values ?? []),
      ...(spec.bools ?? []),
      ...(spec.consumed ?? []),
      "--help",
    ]),
  ];
  return [`Supported flags: ${flags.join(", ")}`];
}

const DEFAULT_LIMIT = 30;

/** Parse a --limit value; strictly a positive integer or a VALIDATION_ERROR. */
export function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  // parseInt would silently coerce "5abc"/"5.9" to 5; require pure digits.
  if (!/^\d+$/.test(raw) || parseInt(raw, 10) <= 0) {
    throw new AxiError(
      `Invalid --limit: ${raw} (expected a positive integer)`,
      "VALIDATION_ERROR",
      ["Example: `--limit 50`"],
    );
  }
  return parseInt(raw, 10);
}

/**
 * Split a user-supplied --fields value. A provided-but-degenerate list
 * (`--fields ,` or empty entries) is a loud error — silently falling back to
 * the default field set would contradict what the caller asked for. Shared by
 * both CLIs so the escape hatch parses identically everywhere.
 */
export function splitFields(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const fields = raw.split(",").map((f) => f.trim());
  if (fields.length === 0 || fields.some((f) => f === "")) {
    throw new AxiError(
      `Invalid --fields value: ${JSON.stringify(raw)}`,
      "VALIDATION_ERROR",
      ["Pass --fields <a,b,c> (comma-separated, no empty names)"],
    );
  }
  return [...new Set(fields)];
}

/**
 * VALIDATION_ERROR for an unknown resource/subcommand, with a did-you-mean
 * line when the typo is close to a known name (mirrors the SDK's top-level
 * unknown-command ergonomics — sweep finding 2026-07-19).
 */
export function unknownSubcommandError(
  kind: string,
  name: string,
  candidates: readonly string[],
  helpCommand: string,
): AxiError {
  const nearest = closestCommand(name, candidates);
  return new AxiError(`Unknown ${kind}: ${name}`, "VALIDATION_ERROR", [
    ...(nearest ? [`Did you mean \`${nearest}\`?`] : []),
    `Run \`${helpCommand}\` for usage`,
  ]);
}
