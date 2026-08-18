# @atlassian-axi/benchmark

Unpublished harness behind [`docs/benchmark-atlassian-agent-surfaces.md`](../../docs/benchmark-atlassian-agent-surfaces.md): it produces the figures comparing jira-axi/confluence-axi, the Atlassian Rovo MCP server, and raw `acli`.
Private on purpose - it must never enter either published package's dependencies or npm tarball (their `files` arrays are `dist`, `skills/<name>`, `LICENSE`, `README.md`).

## Re-running the figures

Prerequisites: workspace built (`pnpm install && pnpm run build`), `acli` installed and logged in (`acli jira auth login`), confluence-axi credentials configured (`auth login --token`), and read access to the target site content referenced in `tasks/tasks.json`.

```
pnpm --filter @atlassian-axi/benchmark run bench            # all three generators
pnpm --filter @atlassian-axi/benchmark run bench:context    # context-window cost figures
pnpm --filter @atlassian-axi/benchmark run bench:output     # per-operation output tokens (live, read-only)
pnpm --filter @atlassian-axi/benchmark run bench:coverage   # coverage matrices -> markdown fragments
```

Outputs land in `artifacts/figures/` and the raw captured texts in `artifacts/raw/`; both are committed so a reader can audit every number.

## Method

- Token counting: `gpt-tokenizer`, `o200k_base` encoding (`src/tokens.ts`), applied identically to every surface.
  Counts are computed over the redacted texts, so committed figures always match committed artifacts.
- Live runs are strictly read-only.
  Write paths are exercised only as error probes against guaranteed-nonexistent targets (`NOPE-99999`, page id `99999999999`, space `NOPESPACE`), which cannot mutate anything.
- The MCP surface cannot be driven here (interactive OAuth; unauthenticated `tools/list` returns HTTP 401 - measured 2026-08-05).
  Its tool list lives in `data/mcp-tools.json`, transcribed from the official supported-tools documentation with source and fetch date; token figures over it are lower bounds because Atlassian does not publish the raw `inputSchema` JSON.
- Redaction (`src/redact.ts`) deterministically replaces the site host, user identities, account ids, non-target space identities, and local paths in everything committed.
  `pnpm --filter @atlassian-axi/benchmark run bench:redact -- <dir>` applies the same substitutions to a directory (used for transcripts).
- Re-running against a different site or different live content changes the site-data-dependent output figures; the context-cost figures depend only on the installed CLI versions and committed data.

## Accuracy-run protocol

Execution and scoring are separate passes with pre-declared expectations:

1. `artifacts/expectations.md` defines the rating scale, executor protocol, task statements, and expected results per task per surface; it is committed before any run (see git history).
2. Each run is a fresh executor agent given only the surface's context (the package skill for the AXI CLIs; `--help` discovery for acli) plus the task statement; its final message is the transcript, saved under `artifacts/transcripts/` and redacted.
   `runs-metadata.json` records commands run, executor tokens, and duration per run.
3. `artifacts/scoring.md` is a separate pass that rates each committed transcript against the expectations only.

To re-run accuracy with a different agent harness, reuse the prompts embedded in `expectations.md` (executor protocol + task statements), commit new transcripts, and score them in a new pass; MCP cells stay `not-rated` unless the runner has an authenticated MCP session.

## Layout

```
data/       curated inputs with provenance (MCP tool list, coverage matrices)
tasks/      representative task set: exact commands per surface, probe targets
src/        generators: context-cost, output-cost, coverage, tokens, redaction
artifacts/  committed evidence: figures, raw captures, expectations, transcripts, scoring
```

## Redaction config (untracked)

The identifying patterns themselves (site host, user identities, client and space names) never live in tracked source.
`src/redact.ts` loads them from `packages/benchmark/redact.local.json`, which is listed in the repo `.gitignore` and must never be committed.
Redaction refuses to run when the file is missing, so a capture can never slip through unredacted by accident.
Tracked source keeps only generic patterns (local paths, Atlassian account ids) and the placeholder replacement names.

The file is a JSON object with a `substitutions` array, applied in order after the generic tracked patterns.
Each entry compiles to `new RegExp(pattern, flags ?? "g")`.
The special entry `{ "wrappedDomainFragment": true }` cleans up a suffix of `emailDomain` stranded alone in a hard-wrapped acli table cell; place it after the email and domain entries.

```json
{
  "emailDomain": "corp-domain.com",
  "substitutions": [
    { "pattern": "real-site\\.atlassian\\.net", "replacement": "example.atlassian.net" },
    { "pattern": "real\\.person(?:@[a-z.]*)?", "flags": "gi", "replacement": "user@example.com" },
    { "pattern": "@?corp-domain\\.com", "flags": "gi", "replacement": "example.com" },
    { "wrappedDomainFragment": true },
    { "pattern": "\\bRealClientName\\b", "replacement": "CLIENTA" }
  ]
}
```
