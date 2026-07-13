# Project agent memory

Project-intrinsic knowledge for `atlassian-axi`: an AXI-family CLI wrapping Atlassian's `acli` for **Jira** and calling the Confluence Cloud **REST API directly** for Confluence. Sibling of `gh-axi`; same conventions.

## What ships today (phasing)

Phase 0 (this scaffold) ships a publishable green-CI skeleton: the no-arg dashboard, `setup hooks`, the inherited `update` command, and the ported domain-agnostic framework. **No `jira`/`confluence`/`auth` commands yet** - those are separate later phases. The full plan lives in the scout report (`atlas-axi-scout-x7/report.md`), section 4.8.

## Build / test / release commands

- `pnpm install` - deps are ONLY `@toon-format/toon` + `axi-sdk-js` (pinned exact `0.1.8`); everything else is dev.
- `pnpm run build` - `tsc` -> `dist/` (ESM, Node16 module resolution; import specifiers carry `.js`).
- `pnpm test` - vitest (`test/` mirrors `src/`).
- `pnpm run lint` - eslint (flat config, `eslint.config.mjs`).
- `pnpm run build:skill` - regenerate `skills/atlassian-axi/SKILL.md` from `src/skill.ts`; `-- --check` fails on drift. **Never hand-edit the SKILL.md** - edit `src/skill.ts` and regenerate.
- `pnpm run dev` - run from source via `tsx`.
- Node `>=20`; CI runs on Node 24 with pnpm.

## Architecture / AXI conventions

- **SDK owns the runtime.** `src/cli.ts` calls `runAxiCli` from `axi-sdk-js`, passing a `commands` map, a `home` handler, `topLevelHelp`, `getCommandHelp`, and `resolveContext`. The SDK handles `--help`/`--version`, leading-flag rejection, unknown-command errors (exit 2), the free `update` command (`RESERVED_COMMANDS`), and error->exit-code shaping. Flags must come AFTER the command.
- **TOON output via FieldDef.** `src/toon.ts` (ported near-verbatim from gh-axi) is the token-efficient output layer: declarative `FieldDef` extractors (`field`/`pluck`/`mapEnum`/`relativeTime`/`custom`/...) feed `renderList`/`renderDetail`/`renderHelp`/`renderError`. All structured output is TOON; there is no plain-text mode. Prefer relative times, enum shortening, and body truncation with a `--full` hint. `src/args.ts`, `src/body.ts`, `src/format.ts` are also ported and domain-agnostic - reuse, don't reinvent.
- **Session-hook mechanism.** `setup hooks` -> SDK `installSessionStartHooks()` writes ambient-context hooks for Claude Code (`~/.claude/settings.json`), Codex (`~/.codex/`), and OpenCode. The hook target is the bin invoked with **no args**, so `src/commands/home.ts` output becomes the agent's session-start block (prefixed with `bin:`/`description:` by the SDK). `home` must be **best-effort and never throw** - a thrown error poisons every session's ambient block. **Tests that touch `installSessionStartHooks` MUST mock it** (see `test/commands/setup.test.ts`) or they mutate the real `~/.claude` on the dev machine.
- **Idempotent mutations (contract for later phases).** Read current state first; if a mutation is a no-op, return a success detail with a `message: "Already ..."` field instead of erroring, then re-fetch and render the authoritative post-state. Re-running a failed mutation must be safe.
- **Errors.** `src/errors.ts` re-exports the SDK's `AxiError`/`exitCodeForError` and carries a (Phase-0-empty) regex pattern map + `mapError()` fallback. Later phases populate it from acli stderr and Confluence HTTP status bodies. `acliNotInstalledError()` is the ENOENT surface for the Jira half.

## Design decisions carried from the scout report

- **`axi-sdk-js` is public on npm** (MIT) - depend directly, pinned exact for supply-chain safety; vendor-fork is the escape hatch if abandoned.
- **Unified auth (later phase):** `atlassian-axi` owns ONE credential (site + email + API token; env `ATLASSIAN_SITE`/`ATLASSIAN_EMAIL`/`ATLASSIAN_API_TOKEN` > 0600 config/keychain), uses it directly for Confluence REST, and bootstraps acli from it (`acli jira auth login --token` via stdin, gated by `acli jira auth status`). Tokens are stdin-only, never argv.
- **Confluence uses two API versions:** v2 (`/wiki/api/v2/...`) for page/space CRUD, v1 (`/wiki/rest/api/search`) for CQL search (v2 has no search).

## Release flow

release-please on `main` (conventional commits) opens a release PR; merging it triggers `npm publish --access public --provenance` via OIDC. `CHANGELOG.md` and `.release-please-manifest.json` are bot-owned - do not hand-edit. Manifest seeded at `0.0.0`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
