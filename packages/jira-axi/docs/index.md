# jira-axi docs

Agent-ergonomic Jira CLI, backed by Atlassian's `acli`.
Every command emits token-efficient TOON output, mutations are idempotent, and errors carry next-step suggestions.

Agents do not need a global install: run any command with `npx -y jira-axi <command>`.

`jira-axi` replaces the Jira half of the sunset combined `atlassian-axi` CLI; the Confluence half is now the separate `confluence-axi` package.

## Read this first

- [Getting started](./getting-started.md) - install, the `acli` prerequisite and login, first commands, session hooks.
- [Limitations](./limitations.md) - what the tool deliberately cannot do. Check here before an operation that might silently fail or no-op.

## Command reference

- [Commands](./commands.md) - `workitem`, `project`, `board`, `sprint`, `filter`, `dashboard`, `field`; every subcommand, flag, and caveat.
- [Setup & update](./setup.md) - `setup hooks` (agent SessionStart context), `update` / `update --check`.

## Fast facts for agents

- Flags come AFTER the command: `jira-axi workitem list --project TEAM`, never before.
- Auth is delegated to `acli`. `jira-axi` has no auth command; run `acli jira auth login` once (install acli via `brew install acli`).
- Work item and comment bodies accept a markdown subset (converted to ADF); raw ADF JSON passes through unchanged.
- Long free text truncates by default with a size marker; the detail command that renders it takes `--full` (see [commands](./commands.md)).
- All structured output is TOON-encoded. There is no plain-text or JSON mode.
- Mutations are non-interactive (`acli --yes`), idempotent, and re-fetch the post-state; re-running a failed mutation is safe.
- Per-command help is always available: `jira-axi <resource> --help` (e.g. `jira-axi workitem --help`).
