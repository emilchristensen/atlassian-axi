// Deterministic redaction applied to every committed artifact captured from
// the live site. Token counts are computed AFTER redaction so committed
// figures always match committed artifacts; the substitutions are
// near-length-neutral, so relative comparisons are unaffected.
//
// The identifying patterns themselves (site host, user identities, client and
// space names) are deliberately not tracked: they load from the untracked
// packages/benchmark/redact.local.json - a JSON object holding an ordered
// "substitutions" array of { pattern, flags?, replacement } entries, each
// compiled with new RegExp(pattern, flags ?? "g") - so tracked source
// carries only generic machinery and placeholder names.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BENCHMARK_ROOT } from "./paths.js";

interface PatternEntry {
  readonly pattern: string;
  readonly flags?: string;
  readonly replacement: string;
}

const CONFIG_PATH = join(BENCHMARK_ROOT, "redact.local.json");

function compileEntry(entry: PatternEntry): readonly [RegExp, string] {
  if (typeof entry.pattern !== "string" || typeof entry.replacement !== "string") {
    throw new Error(`redact: every substitution in ${CONFIG_PATH} needs string "pattern" and "replacement"`);
  }
  return [new RegExp(entry.pattern, entry.flags ?? "g"), entry.replacement];
}

function loadLocalSubstitutions(): ReadonlyArray<readonly [RegExp, string]> {
  let raw: string;
  try {
    raw = readFileSync(CONFIG_PATH, "utf8");
  } catch {
    throw new Error(
      `redact: missing ${CONFIG_PATH}; this untracked file holds the real identifier patterns and redaction refuses to run without it`,
    );
  }
  const config = JSON.parse(raw) as { substitutions?: readonly PatternEntry[] };
  if (!Array.isArray(config.substitutions)) {
    throw new Error(`redact: ${CONFIG_PATH} must contain a "substitutions" array`);
  }
  return config.substitutions.map(compileEntry);
}

// Generic patterns only - nothing here identifies the site or its users.
const GENERIC_SUBSTITUTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  // Local worktree paths carry no information a reader needs.
  [/\/Users\/\S*?\/atlassian-axi\/packages\//g, "<repo>/packages/"],
  // Atlassian accountIds (opaque user identifiers), 24- and 32-hex forms.
  [/\b[0-9a-f]{32}\b/g, "redacted-account-id-32xxx"],
  [/\b[0-9a-f]{24}\b/g, "redacted-account-id-xxxxx"],
  [/\b(?:557058|712020|5[0-9a-f]{7}):[0-9a-f-]{8,}\b/g, "redacted:account-id"],
];

let cached: ReadonlyArray<readonly [RegExp, string]> | undefined;

function substitutions(): ReadonlyArray<readonly [RegExp, string]> {
  cached ??= [...GENERIC_SUBSTITUTIONS, ...loadLocalSubstitutions()];
  return cached;
}

export function redact(text: string): string {
  return substitutions().reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
}
