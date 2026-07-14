# Project agent memory

Project-intrinsic knowledge for `atlassian-axi`: an AXI-family CLI wrapping Atlassian's `acli` for **Jira** and calling the Confluence Cloud **REST API directly** for Confluence. Sibling of `gh-axi`; same conventions.

## What ships today (phasing)

Phase 0 shipped the publishable green-CI skeleton (dashboard, `setup hooks`, inherited `update`, ported framework). Phase 1 shipped **auth + config** - `src/config.ts` (unified credential), `src/acli.ts` (acli shell-out), and the `auth login/status/logout` commands. Phase 2 shipped the **Jira MVP** - `src/commands/jira/` (`workitem` list/view/create/edit/transition/assign/comment/search, `project` list/view), `src/suggestions.ts`, acli stderr patterns in `errors.ts`, and the dashboard's best-effort `my_open_workitems`. **No `confluence` surface yet** - that is Phase 3. The full plan lives in the scout report (`atlas-axi-scout-x7/report.md`), section 4.8.

**Jira half facts (Phase 2, verified live against acli v1.3.22).** acli has NO `workitem list` subcommand - our `list` builds JQL and calls `workitem search`; comments live under the `workitem comment <create|list|...>` group. acli REJECTS unbounded JQL, so a bare `list` uses an `updated >= -30d` window. `search --fields` has a whitelist that rejects `updated` (list output has no updated column); `view` omits created/updated/priority unless requested via `--fields` (we always pass the full set); `comment list --json` comments are flat `{id, author, body, visibility}` strings (no created, no ADF). Fixtures in `test/fixtures/acli.ts` were captured live and anonymized (provenance in the file header - update them together with the tolerant accessors in `src/commands/jira/shared.ts` if a re-capture disagrees). Mutations are `--yes`-gated non-interactive, re-fetch via `workitem view` after mutating, and never parse mutation output beyond a tolerant created-key probe.

**Auth/config seams (Phase 1).** `config.ts` is the single credential source of truth: resolution is env (`ATLASSIAN_SITE`/`_EMAIL`/`_API_TOKEN`) > keychain > 0600 `~/.config/atlassian-axi/config.json` (path honours `XDG_CONFIG_HOME`). Token is stdin-only (`readTokenFromStdin` throws on TTY). acli is a *derived cache*: `auth login` persists to our store, then status-gates `acli jira auth status` before bootstrapping `acli jira auth login`. For tests, inject fakes via `setAcliRunner()` (acli.ts) and `setKeychainBackend()` (config.ts); force the file-fallback path with `ATLASSIAN_AXI_NO_KEYCHAIN=1`. Never let tests hit real acli/keychain/network - the `security` CLI and `fetch` (Confluence REST ping) are stubbed.

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
