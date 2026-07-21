# atlassian-axi docs

Agent-ergonomic CLI for Atlassian: Jira via Atlassian `acli`, Confluence via the Cloud REST API directly.
Every command emits token-efficient TOON output, mutations are idempotent, and errors carry next-step suggestions.

Agents do not need a global install: run any command with `npx -y atlassian-axi <command>`.

## Read this first

- [Getting started](./getting-started.md) - install, prerequisites, auth quickstart, first commands, session hooks.
- [Limitations](./limitations.md) - what the tool deliberately cannot do. Check here before an operation that might silently fail or no-op.

## Command reference

- [auth](./auth.md) - `login`, `login --token`, `status`, `logout`; credential modes, resolution order, `--site`, OAuth threat model.
- [jira](./jira.md) - `workitem`, `project`, `board`, `sprint`, `filter`, `dashboard`, `field`.
- [confluence](./confluence.md) - `page` (get/create/update/delete/attachments/labels/children), `space`, `search`.
- [setup & update](./setup-and-update.md) - `setup hooks` (agent SessionStart context), `update` / `update --check`.

## Fast facts for agents

- Flags come AFTER the command: `atlassian-axi jira workitem list --project TEAM`, never before.
- For agents/CI, authenticate with `auth login --token` (token via stdin) or the `ATLASSIAN_SITE`/`ATLASSIAN_EMAIL`/`ATLASSIAN_API_TOKEN` env vars. The OAuth browser flow needs a TTY and is for humans.
- Jira needs `acli` installed (`brew install acli`); Confluence needs nothing extra.
- Jira/comment bodies accept a markdown subset (converted to ADF). Confluence page bodies are raw storage-format XHTML - markdown is NOT converted there.
- `confluence page update` is a full-body replace guarded against dropping embedded macros/whiteboards. It cannot create or edit diagrams/whiteboards, only preserve them.
- Bodies truncate by default; pass `--full` on `jira workitem view` and `confluence page get`.
- Per-command help is always available: `atlassian-axi <command> --help` (and deeper: `atlassian-axi jira workitem --help`).
