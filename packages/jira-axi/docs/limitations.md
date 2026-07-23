# Limitations and caveats

Everything `jira-axi` deliberately cannot do, plus behaviors that will surprise an agent.

Consult this before attempting an operation that may silently fail, no-op, or return misleading output.

## No native `workitem list`; unbounded JQL is rejected

acli has no `workitem list` subcommand; the CLI builds JQL and calls `workitem search`.
acli rejects unbounded JQL, so a bare `workitem list` with no filters applies an `updated >= -30d` window.
To go wider, pass explicit `--jql` or use `workitem search "<JQL>"` with a bounded query.
An empty result under this default window discloses it in a `scope:` line, so `count: 0` is not mistaken for "no work items exist".

## `search --fields` whitelist rejects some fields

The `--fields` whitelist for `list`/`search` rejects fields absent from list output, e.g. `updated`.
Inspect time fields with `workitem view <KEY> --fields <a,b,c>` instead (view accepts a broader set).

## No field list or view

`field` is mutations only: `create`, `update`, `delete`, `restore`.
acli has no field list/view - inspect field values with `workitem view <KEY> --fields <a,b,c>`.
`field delete` and `field restore` have no `--json` from acli, so the CLI renders its own confirmation.
`delete` moves the field to trash (restorable via `restore`).

## No dashboard list/view beyond search

acli `dashboard` has only `search`; the CLI's `dashboard list` maps onto it.
There is no `dashboard view`.

## `sprint list-workitems` requires both IDs

`sprint list-workitems <ID>` requires BOTH the sprint ID and `--board <ID>` (a Jira agile API constraint).
Find board IDs via `board list`, sprint IDs via `board list-sprints <BOARD_ID>`.

## Comment rendering is lossy

`workitem view --comments` is lossy: acli flattens ADF comment bodies upstream (drops list items, strips marks to double spaces).
The CLI can only render what acli returns.
The stored comment ADF is intact - verify the true content in the Jira UI, not through acli.

## Mutations are non-interactive and `--yes`-gated

All Jira mutations run `--yes`-gated and non-interactive by design; there are no interactive prompts.
Mutations are idempotent and re-fetch after applying: `transition --to <status>` and `sprint update --state` are no-op successes when already in that state, so re-running a failed mutation is safe.

## TOON output only

All structured output is TOON-encoded.
There is no plain-text or JSON output mode.
Long free text is truncated by default with a size marker; the detail command that renders it takes `--full` for the complete text. See [commands](./commands.md) for the commands that accept it.

## Flags must come after the command

Flags are rejected before the command name.
Write `jira-axi workitem list --project TEAM`, not `jira-axi --project TEAM workitem list`.
