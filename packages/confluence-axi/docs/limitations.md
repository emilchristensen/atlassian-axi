# Limitations and caveats

Everything `confluence-axi` deliberately cannot do, plus behaviors that will surprise an agent.

Consult this before attempting an operation that may silently fail, no-op, or return misleading output.
See also [auth](./auth.md).

## No diagram or whiteboard creation or editing

The tool cannot create or edit Confluence whiteboards, diagrams, or any other `<ac:structured-macro>` embed.
It can only preserve existing macros: [`page update`](./commands.md) is a full-body replace that refuses by default when the new body drops a macro the current page still has (the macro-loss guard).
`droppedMacros()` compares macro `ac:name`s by count, so dropping one of two identical embeds is still caught; title-only edits keep the body and never trigger the guard.
Correct pattern to keep an embed: `page get <id> --full`, then carry the `<ac:structured-macro ...>` block verbatim into your new `--body`/`--body-file`; pass `--allow-macro-loss` only to drop it on purpose.
Never mutate a stateful Confluence canvas (whiteboard) through browser automation either - edits there are irreversible and there is no undo.

## No attachment upload

Attachments are read-only.
`page attachments <id>` lists and filters (`--filename`, `--media-type`) only; there is no upload subcommand.
Upload via the Confluence UI instead (it is a multipart v1 flow, out of scope for this CLI).

## No markdown conversion for page bodies

Confluence page bodies take storage-format XHTML, or Atlas Doc Format via `--format adf`.
Markdown passed to `page create`/`page update --body` is stored literally, not converted, so it renders as raw text.
This is by design and is user error, not a bug.

## No v2 search; v2 collections have no total count

CQL search is v1-only (`/wiki/rest/api/search`); the v2 API has no search endpoint.
Use `confluence-axi search "<CQL>"` for search.
v2 list collections (`page children`, `space list`, `page attachments`, `page labels`) paginate by cursor and report no total count - do not expect a total.

## Label mutations manage global-prefix labels only

`page labels <id> --add/--remove` mutates GLOBAL-prefix labels only (v1 mutation endpoint; v2 has no label mutation).
Listing can filter other prefixes with `--prefix <my|team|global|system>`, but you cannot add or remove non-global labels through this CLI.
Mutations are idempotent: already-present/absent names are reported and the full post-mutation label set is rendered.

## A bare 404 is not proof of absence

Confluence masks permission errors as 404 (verified live).
A `page create` without space create-permission and a `page delete` without delete-permission both return 404, not 403.
`page create` re-maps a POST 404 to FORBIDDEN; `page delete` re-reads after a DELETE 404 and only claims "Already deleted" when the page is actually gone, else FORBIDDEN.
Never treat a bare Confluence 404 as proof that a page does not exist.

## Trashed pages read as 200

A v2 GET on a trashed page returns 200 with `status: "trashed"`, and DELETE on it 404s.
`page delete` treats a trashed page as already-deleted (no-op success), so re-deleting is safe and does not report a false error.

## `--site` retargeting and OAuth

`--site` feeds credential resolution (flag > env > stored) and retargets the Confluence instance.
In OAuth mode the transport refuses an override differing from the pinned session cloudId, so `--site` only retargets in API-token mode there.
Atlassian API tokens are account-scoped, so one token reaches every instance the account can access.

The OAuth (browser) flow requires an interactive TTY and fails fast with VALIDATION_ERROR when stdin/stdout is not a terminal.
For agents and CI, use `auth login --token` (token read from stdin only, never as an argument).
There is no shipped OAuth app; register your own (see [auth](./auth.md#registering-your-own-oauth-app)).

## TOON output only

All structured output is TOON-encoded.
There is no plain-text or JSON output mode.
Bodies are truncated by default; pass `--full` (on `page get`) for the complete body.

## Flags must come after the command

Flags are rejected before the command name.
Write `confluence-axi search "space = ENG" --limit 5`, not `confluence-axi --limit 5 search "space = ENG"`.
