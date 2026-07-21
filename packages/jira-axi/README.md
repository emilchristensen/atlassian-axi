# jira-axi

Agent-ergonomic Jira CLI, backed by Atlassian's `acli`.
Token-efficient TOON output, contextual error suggestions, idempotent mutations.
Self-contained: auth is delegated to `acli`'s own login, so there is no extra credential setup in this tool.

> Sunset note: `jira-axi` replaces the Jira half of the combined `atlassian-axi` CLI, which is now sunset and split into two per-bin packages.
> The resource-group prefix is gone: what was `atlassian-axi jira workitem list` is now `jira-axi workitem list`.
> The Confluence half moved to the separate [`confluence-axi`](https://www.npmjs.com/package/confluence-axi) package.

## Install

No global install is needed.
Run any command through `npx`:

```bash
npx -y jira-axi <command>
```

## Prerequisites

- Node >= 20.
- `acli` (the Atlassian CLI) - required, this tool shells out to it for every Jira operation.
  Install it with `brew install acli`.
- An `acli` login. `jira-axi` has NO auth command of its own; authenticate `acli` once:

```bash
acli jira auth login
```

If `acli` is not installed or not logged in, `jira-axi` commands error with a next-step suggestion.

## Quickstart

```bash
# one-time: log acli into your Jira site
acli jira auth login

# ambient dashboard (no args): your open work items + acli status
npx -y jira-axi

# list work items on a project
npx -y jira-axi workitem list --project TEAM

# view one item with comments
npx -y jira-axi workitem view TEAM-1 --comments

# create a work item (mutations re-fetch and render the result)
npx -y jira-axi workitem create --project TEAM --type Task --summary "Fix login"
```

Flags MUST come after the command: `jira-axi workitem list --project TEAM`, never `jira-axi --project TEAM workitem list`.

## Commands

All commands are flattened and per-bin (no `jira` prefix).
Resources are addressed two ways: `workitem`/`project` are KEY-addressed (`TEAM-1`, `TEAM`); `board`/`sprint`/`filter`/`dashboard`/`field` are ID-addressed (numeric).

- `workitem` - `list`, `view <KEY>`, `create`, `edit <KEY>`, `transition <KEY>`, `assign <KEY>`, `comment <KEY>`, `search "<JQL>"`
- `project` - `list`, `view <KEY>`
- `board` - `list`, `view <ID>`, `list-sprints <ID>`, `list-projects <ID>`
- `sprint` - `view <ID>`, `list-workitems <ID> --board <ID>`, `create`, `update <ID>`
- `filter` - `list`, `search`, `view <ID>`, `update <ID>`
- `dashboard` - `list`
- `field` - `create`, `update <ID>`, `delete <ID>`, `restore <ID>` (no list/view; acli has none)
- `setup hooks` - install agent SessionStart ambient-context hooks
- `update` / `update --check` - self-upgrade the CLI (inherited built-in)

Per-command help is always available: `jira-axi <resource> --help` (e.g. `jira-axi workitem --help`).

## Output and behavior

All structured output is TOON-encoded and token-efficient; there is no plain-text or JSON mode.
Bodies truncate by default - pass `--full` on `workitem view` for complete bodies.
Mutations run non-interactively (`acli --yes`), are idempotent, and re-fetch the authoritative post-state, so re-running a failed mutation is safe.

## Docs

See [./docs](./docs/index.md):

- [Getting started](./docs/getting-started.md)
- [Commands](./docs/commands.md)
- [Limitations](./docs/limitations.md)
- [Setup and update](./docs/setup.md)

## License

MIT
