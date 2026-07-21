# Limitations and caveats

Everything `atlassian-axi` deliberately cannot do, plus behaviors that will surprise an agent.

Consult this before attempting an operation that may silently fail, no-op, or return misleading output.
See also [auth](./auth.md).

## Confluence

### No diagram or whiteboard creation or editing

The tool cannot create or edit Confluence whiteboards, diagrams, or any other `<ac:structured-macro>` embed.
It can only preserve existing macros: [`page update`](./confluence.md) is a full-body replace that refuses by default when the new body drops a macro the current page still has (the macro-loss guard).
`droppedMacros()` compares macro `ac:name`s by count, so dropping one of two identical embeds is still caught; title-only edits keep the body and never trigger the guard.
Correct pattern to keep an embed: `page get <id> --full`, then carry the `<ac:structured-macro ...>` block verbatim into your new `--body`/`--body-file`; pass `--allow-macro-loss` only to drop it on purpose.
Never mutate a stateful Confluence canvas (whiteboard) through browser automation either - edits there are irreversible and there is no undo.

### No attachment upload

Attachments are read-only.
`page attachments <id>` lists and filters (`--filename`, `--media-type`) only; there is no upload subcommand.
Upload via the Confluence UI instead (it is a multipart v1 flow, out of scope for this CLI).

### No markdown conversion for page bodies

Confluence page bodies take storage-format XHTML, or Atlas Doc Format via `--format adf`.
Markdown passed to `page create`/`page update --body` is stored literally, not converted, so it renders as raw text.
This is by design and is user error, not a bug.
(Jira `workitem`/`comment` bodies DO convert markdown to ADF - that conversion applies to Jira only.)

### No v2 search; v2 collections have no total count

CQL search is v1-only (`/wiki/rest/api/search`); the v2 API has no search endpoint.
Use `confluence search "<CQL>"` for search.
v2 list collections (`page children`, `space list`, `page attachments`, `page labels`) paginate by cursor and report no total count - do not expect a total.

### Label mutations manage global-prefix labels only

`page labels <id> --add/--remove` mutates GLOBAL-prefix labels only (v1 mutation endpoint; v2 has no label mutation).
Listing can filter other prefixes with `--prefix <my|team|global|system>`, but you cannot add or remove non-global labels through this CLI.
Mutations are idempotent: already-present/absent names are reported and the full post-mutation label set is rendered.

### A bare 404 is not proof of absence

Confluence masks permission errors as 404 (verified live).
A `page create` without space create-permission and a `page delete` without delete-permission both return 404, not 403.
`page create` re-maps a POST 404 to FORBIDDEN; `page delete` re-reads after a DELETE 404 and only claims "Already deleted" when the page is actually gone, else FORBIDDEN.
Never treat a bare Confluence 404 as proof that a page does not exist.

### Trashed pages read as 200

A v2 GET on a trashed page returns 200 with `status: "trashed"`, and DELETE on it 404s.
`page delete` treats a trashed page as already-deleted (no-op success), so re-deleting is safe and does not report a false error.

## Jira

### No native `workitem list`; unbounded JQL is rejected

acli has no `workitem list` subcommand; the CLI builds JQL and calls `workitem search`.
acli rejects unbounded JQL, so a bare `workitem list` with no filters applies an `updated >= -30d` window.
To go wider, pass explicit `--jql` or use `workitem search "<JQL>"` with a bounded query.

### `search --fields` whitelist rejects some fields

The `--fields` whitelist for `list`/`search` rejects fields absent from list output, e.g. `updated`.
Inspect time fields with `workitem view <KEY> --fields <a,b,c>` instead (view accepts a broader set).

### No field list or view

`jira field` is mutations only: `create`, `update`, `delete`, `restore`.
acli has no field list/view - inspect field values with `jira workitem view <KEY> --fields <a,b,c>`.
`field delete` and `field restore` have no `--json` from acli, so the CLI renders its own confirmation.
`delete` moves the field to trash (restorable via `restore`).

### No dashboard list/view beyond search

acli `dashboard` has only `search`; the CLI's `dashboard list` maps onto it.
There is no `dashboard view`.

### `sprint list-workitems` requires both IDs

`sprint list-workitems <ID>` requires BOTH the sprint ID and `--board <ID>` (a Jira agile API constraint).
Find board IDs via `jira board list`, sprint IDs via `jira board list-sprints <BOARD_ID>`.

### Comment rendering is lossy

`workitem view --comments` is lossy: acli flattens ADF comment bodies upstream (drops list items, strips marks to double spaces).
The CLI can only render what acli returns.
The stored comment ADF is intact - verify the true content in the Jira UI, not through acli.

### Mutations are non-interactive and `--yes`-gated

All Jira mutations run `--yes`-gated and non-interactive by design; there are no interactive prompts.
Mutations are idempotent and re-fetch after applying: `transition --to <status>` and `sprint update --state` are no-op successes when already in that state, so re-running a failed mutation is safe.

## Auth and multi-site

### `--site` retargeting is Confluence-only

Only the Confluence half honours `--site` (flag > env > stored).
The Jira router throws VALIDATION_ERROR when `--site` differs from the stored/acli login site, because acli is bound to its own login.
The OAuth transport refuses an override differing from the pinned session cloudId.
Atlassian API tokens are account-scoped, so one token reaches every instance the account can access; you retarget Confluence with `--site`, not Jira.

### OAuth cannot bootstrap acli

The OAuth (browser) flow cannot configure acli - acli needs an API token.
`auth status` in OAuth mode reports the acli half separately and honestly.
Use `auth login --token` (site + email + API token via stdin) to bootstrap the Jira/acli half.

### OAuth needs an interactive TTY

`auth login` (OAuth) fails fast with VALIDATION_ERROR when stdin/stdout is not a TTY.
For agents and CI, use `auth login --token` (token read from stdin only, never as an argument).

### OAuth 3LO has no PKCE / public-client option

The shipped OAuth app is a confidential client with no PKCE, so the bundled client secret is effectively public.
For a stronger posture, register your own Atlassian app and override via `ATLASSIAN_AXI_OAUTH_CLIENT_ID` / `ATLASSIAN_AXI_OAUTH_CLIENT_SECRET`.

## Output and general

### TOON output only

All structured output is TOON-encoded.
There is no plain-text or JSON output mode.
Bodies are truncated by default; pass `--full` (on `workitem view` / `confluence page get`) for complete bodies.

### Flags must come after the command

Flags are rejected before the command name.
Write `atlassian-axi jira workitem list --project TEAM`, not `atlassian-axi --project TEAM jira workitem list`.
