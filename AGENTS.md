# Project agent memory

Project-intrinsic knowledge for this repo: a **Turborepo monorepo** shipping two agent-ergonomic Atlassian CLIs in the AXI family (sibling of `gh-axi`, same conventions):

- **`jira-axi`** - Jira, backed by Atlassian's `acli`.
- **`confluence-axi`** - Confluence Cloud, calling the REST API directly.

The former single **`atlassian-axi`** package is **SUNSET** (unpublished from npm; the name is no longer shipped). It was split so the Jira tool can be fully self-contained with zero auth setup (acli owns Jira auth), while the Confluence tool carries the OAuth/REST auth only it needs.

## Layout

```
packages/
  core/            # @atlassian-axi/core - PRIVATE, never published. Domain-agnostic
                   #   AXI framework: toon, args, body, format, context, shared
                   #   subcommand plumbing, the suggestion ENGINE, the error ENGINE.
  jira-axi/        # published: jira-axi   (bin: jira-axi)
  confluence-axi/  # published: confluence-axi (bin: confluence-axi)
```

- **core is bundled, not depended-on at runtime.** Each CLI's `tsup` build inlines `@atlassian-axi/core` (and `@toon-format/toon`) via `noExternal`, so each published package is self-contained; only `axi-sdk-js` stays an external runtime dep. core is a `workspace:*` devDependency of each CLI. Never publish core.
- **Commands are FLATTENED per CLI** (single-domain, no resource-group prefix): `jira-axi workitem list`, `jira-axi board list-sprints <ID>`, `confluence-axi page get <id>`, `confluence-axi search "<CQL>"`. There is no `jira`/`confluence` sub-namespace.
- **core owns engines, each CLI owns its domain content.** `core/src/suggestions.ts` = `matchSuggestions(table, ctx, binName)` (bin-parameterized); each CLI has its own `src/suggestions.ts` table + `getSuggestions`. `core/src/errors.ts` = `matchError(raw, patterns, fallback)` + shared `AxiError`/`ErrorCode`/`ErrorPattern`/`firstLine`; jira-axi's `src/errors.ts` holds the acli patterns + `mapError` + `acliNotInstalledError`, confluence-axi's holds `confluenceHttpError`.

## jira-axi facts

- **Self-contained, no auth of its own.** No config/oauth/prompt, no `auth` command, no `--site`. Auth is delegated entirely to acli's native `acli jira auth login` (install acli: `brew install acli`). If acli is not installed/logged-in, commands surface acli's own error (`acliNotInstalledError()` + the acli stderr patterns in `src/errors.ts`). Test seam: `setAcliRunner()` in `src/acli.ts` - never hit real acli.
- **acli facts (verified live, acli v1.3.22).** acli has NO `workitem list` (our `list` builds JQL and calls `workitem search`); it REJECTS unbounded JQL, so a bare `list` uses an `updated >= -30d` window. `search --fields` whitelist rejects `updated`. `view` omits created/updated/priority unless requested via `--fields`; `--fields a,b` always includes `key` and rejects `--full`. `comment list --json` bodies are flat `{id,author,body,visibility}` strings and acli flattens ADF LOSSILY upstream (drops list items, strips marks) - `workitem view --comments` renders only what acli returns; stored ADF is intact (verify in the Jira UI). Mutations are `--yes`-gated non-interactive, re-fetch via `view` after mutating.
- **Agile/admin (verified live).** Boards/sprints/filters/dashboards are ID-addressed (numeric; `requireNumericId`), workitems/projects key-addressed. acli has NO `board list`/`dashboard list` (map onto `search`); `field` is mutations only (create/update/delete/restore), no list/view - inspect field values via `workitem view <KEY> --fields`. Envelope keys differ per collection (`board search`->`values`, `board list-sprints`->`sprints`, `board list-projects`->`projects` with STRING `id` + `type`); `filter list` requires one of `--my`/`--favourite` (defaults `--my`). `sprint list-workitems` needs BOTH the sprint id and `--board`. On failure acli often prints the real reason on STDOUT + generic on stderr - `errorText()` in `acli.ts` prefers stdout. Sprint dates render `YYYY-MM-DD` (`dateOnly`), not relative.
- **Markdown -> ADF.** Jira `description`/comment `body` are ADF. `src/adf.ts` `markdownToAdf` converts a markdown `--body`/`--body-file` to structured ADF (`bodyToAdf` passes raw ADF JSON through, wraps plain text); `writeAdfTempFile` feeds acli's `--description-file`/`--body-file`. A bare string arg is stored as ONE flat text node (renders markdown literally - the pre-fix bug). Focused subset (headings, nested lists, inline/block code, bold/italic, links), NOT full CommonMark, dependency-free on purpose. Fake acli reads the temp file back (`bodyFile` on `AcliCall`).
- Fixtures `test/fixtures/acli.ts` were captured live + anonymized (provenance header); update with the tolerant accessors in `src/commands/jira/shared.ts` if a re-capture disagrees.

## confluence-axi facts

- **Two API versions by design:** v2 (`/wiki/api/v2/...`) for page/space CRUD + attachments/children + label LISTING; v1 (`/wiki/rest/api/...`) for CQL search (v2 has NO search) + label MUTATIONS (v2 has none). `page create --space <KEY>` resolves key->numeric `spaceId` via `GET /spaces?keys=`. v1 search decorates title/excerpt with `@@@hl@@@` markers (stripped in `src/commands/confluence/shared.ts`); v2 collections paginate by cursor (`_links.next`), no total count. Label mutations: `POST .../content/{id}/label` takes bare `[{prefix,name}]`, `DELETE .../label?name=` (query-param variant; path variant breaks on `/`); CLI pre-reads for idempotency then re-fetches the v2 label set as authoritative. Attachments read-only (upload is a multipart v1 flow, out of scope).
- **`page update` is a full-body replace with a macro-loss guard:** a new `--body` dropping an `<ac:structured-macro>` the page has (embedded whiteboard/diagram) is refused (VALIDATION_ERROR) unless `--allow-macro-loss`. `droppedMacros()` compares `ac:name`s by count; title-only edits keep the body. Pattern: `page get <id> --full` -> edit -> `page update --body-file` keeping the macro block. The CLI cannot CREATE or EDIT diagrams/whiteboards, only preserve them.
- **Trash semantics:** v2 GET on a trashed page returns 200 + `status:"trashed"`, DELETE 404s - `page delete` treats trashed as already-deleted (`pageStillExists` requires `status==="current"`).
- **404 masks permission errors** (verified live): create without space-permission and delete without delete-permission both 404, not 403. `page create` re-maps POST 404 -> FORBIDDEN; `page delete` re-reads after DELETE 404 and only claims "Already deleted" when actually gone. Never treat a bare 404 as proof of absence.
- **Confluence page bodies are NOT markdown** - raw storage-format XHTML (or `--format adf`) by design; markdown there is user error (unlike Jira).
- **Auth: OAuth 3LO + API token.** `config.ts` is the credential source of truth: env (`ATLASSIAN_SITE`/`_EMAIL`/`_API_TOKEN`) > keychain > 0600 `~/.config/atlassian-axi/config.json` (honours `XDG_CONFIG_HOME`; force file path with `ATLASSIAN_AXI_NO_KEYCHAIN=1`). Token is stdin-only. Mode resolution: `ATLASSIAN_API_TOKEN` env > stored OAuth session > stored API token; a half-configured env token is a loud `none`.
- **OAuth (3LO), env-required, NO shipped app.** Client id is env-required (`ATLASSIAN_AXI_OAUTH_CLIENT_ID`; `oauthClientId()` throws VALIDATION_ERROR when unset). Confidential client - secret from `ATLASSIAN_AXI_OAUTH_CLIENT_SECRET` env or prompted once (hidden, stderr) and stored 0600; env secrets never persisted. Callback EXACTLY `http://localhost:8765/callback`. Users register their own app: Atlassian 3LO has no public-client/PKCE option and both its token AND refresh grants require the secret, so a distributed CLI cannot ship a turnkey app without a hosted token broker; env-required is Atlassian's recommended pattern. Refresh tokens ROTATE (persist the newest); `confluenceJson` refreshes proactively (60s skew) + one forced retry on 401; OAuth mode targets `https://api.atlassian.com/ex/confluence/{cloudId}` with Bearer. OAuth needs a TTY (fails fast otherwise). Test seams: `setOAuthFetch()`/`setConfluenceFetch()`/`setBrowserOpener()`, `startCallbackServer({port:0})`; fixtures hand-authored (provenance headers). NOTE the on-disk config dir + OAuth env-var names keep the `atlassian-axi` prefix (shared credential store; renaming is out of scope).
- **`--site` retargeting** feeds `setSiteOverride()` (cli.ts resolveContext) into credential resolution (flag > env > stored); the OAuth transport refuses an override differing from the pinned session cloudId. API tokens are account-scoped.
- Fixtures `test/fixtures/{confluence,oauth}.ts` are hand-authored from published REST/OAuth contracts (provenance headers); update with the tolerant accessors if a live capture disagrees.

## Build / test / release

- `pnpm install` - workspace install (pnpm + Turbo).
- `pnpm run build` - turbo: `tsc` for core, `tsup` for each CLI (ESM, self-contained bin at `dist/bin/<bin>.js`). **tsup's `banner` adds the shebang - the bin SOURCE must NOT have one, or the built binary double-shebangs and crashes (SyntaxError).**
- `pnpm run typecheck` / `pnpm test` (vitest per package) / `pnpm run lint` (each package re-exports `eslint.config.base.mjs`).
- `pnpm run build:skill` per package regenerates `packages/<pkg>/skills/<pkg>/SKILL.md` from `src/skill.ts`; `-- --check` fails on drift. **Never hand-edit SKILL.md.**
- Per-package: `pnpm --filter jira-axi <script>` / `pnpm --filter confluence-axi <script>`.
- Node `>=20`; CI (Node 24) runs lint + build + typecheck + test at the root (turbo fans out).

## AXI conventions (both CLIs)

- **SDK owns the runtime.** `src/cli.ts` calls `runAxiCli` from `axi-sdk-js` with a flattened `commands` map, `home`, `topLevelHelp`, `getCommandHelp`, (`resolveContext` for confluence-axi's `--site`). SDK handles `--help`/`--version`, leading-flag rejection, unknown-command (exit 2), the free `update` command, exit-code shaping. **Flags come AFTER the command.**
- **TOON output via FieldDef** (`core/src/toon.ts`, ported from gh-axi): `field`/`pluck`/`mapEnum`/`relativeTime`/`custom` feed `renderList`/`renderDetail`/`renderHelp`/`renderError`. All output is TOON; no plain-text mode. Truncate bodies with a `--full` hint.
- **Session hooks:** `setup hooks` -> SDK `installSessionStartHooks()` writes ambient-context hooks (Claude Code `~/.claude/settings.json`, Codex, OpenCode) targeting the bin with no args, so `src/commands/home.ts` output becomes the session-start block. `home` MUST be best-effort and never throw. **Tests touching `installSessionStartHooks` MUST mock it** or they mutate the real `~/.claude`.
- **Idempotent mutations:** read current state first; a no-op returns a success detail with `message: "Already ..."`, then re-fetches the authoritative post-state. Re-running a failed mutation is safe.
- **Exit-code contract:** dispatcher `default:` branches THROW `AxiError(..., "VALIDATION_ERROR")` (exit 2), never `return renderError(...)` (a returned string is success -> exit 0; was the v0.1.0 blocker). Unknown top-level -> SDK `renderUnknownCommand` hook (did-you-mean via `closestCommand()`); resource/subcommand -> `unknownSubcommandError()` in `core/src/shared.ts`.
- **Help routing:** register every flattened resource in each CLI's `COMMAND_HELP` so deep `--help` serves the right resource help.

## Release flow

release-please on `main` (conventional commits) in **manifest/monorepo mode** (`release-please-config.json` has per-package entries for `packages/jira-axi` + `packages/confluence-axi`; components `jira-axi`/`confluence-axi`, `separate-pull-requests: true`). Merging a package's release PR tags it + publishes THAT package: `.github/workflows/release-please.yml` loops `paths_released` and runs `npm publish --access public` per dir. `CHANGELOG.md` + `.release-please-manifest.json` are bot-owned - do not hand-edit.

**Publishing = npm TRUSTED PUBLISHING (OIDC), no token.** The workflow has `id-token: write`, pins `npm@latest` (OIDC needs npm >= 11.5.1), and publishes with no `NODE_AUTH_TOKEN`; provenance is automatic. Each package needs a trusted publisher configured on npmjs.com (org `emilchristensen`, repo `atlassian-axi`, workflow `release-please.yml`). npm is deprecating token/2FA-bypass publishing (sensitive actions ~Aug 2026, direct publish ~Jan 2027), which is why there is no `NPM_TOKEN` fallback.

**First publish of a NEW package name is a chicken-and-egg:** a trusted publisher can only be configured on an existing package's settings page, so a brand-new name's first publish must be bootstrapped once by hand (`cd packages/<pkg> && npm login && npm publish --access public`, entering the 2FA OTP; that one release has no provenance). Then configure the trusted publisher and every later release publishes tokenless + provenanced via CI. `.github/workflows/publish.yml` is a `workflow_dispatch` OIDC publish for re-running a single already-tagged package. jira-axi was bootstrapped at 0.2.0 (via `release-as` in the config, since removed); confluence-axi still needs the same one-time bootstrap before its first release. Manifest seeded at `0.0.0`.

## Maintaining this file

Keep knowledge useful to almost every future session. Do not repeat what the code shows - point to the authoritative file/command. Prefer rewriting/pruning over appending.
