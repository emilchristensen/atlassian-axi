# confluence-axi docs

Agent-ergonomic CLI for Confluence Cloud, calling the Confluence REST API directly.
Every command emits token-efficient TOON output, mutations are idempotent, and errors carry next-step suggestions.

Agents do not need a global install: run any command with `npx -y confluence-axi <command>`.

## Read this first

- [Getting started](./getting-started.md) - install, auth quickstart (both modes), first commands, session hooks, verify.
- [Limitations](./limitations.md) - what the tool deliberately cannot do. Check here before an operation that might silently fail or no-op.

## Command reference

- [commands](./commands.md) - `page` (get/create/update/delete/attachments/labels/children), `space`, `search`.
- [auth](./auth.md) - `login`, `login --token`, `status`, `logout`; credential modes, resolution order, `--site`, registering your own OAuth app, threat model.
- [setup & update](./setup.md) - `setup hooks` (agent SessionStart context), `update` / `update --check`.

## Fast facts for agents

- Flags come AFTER the command: `confluence-axi search "space = ENG" --limit 5`, never before.
- For agents/CI, authenticate with `confluence-axi auth login --token` (token via stdin) or the `ATLASSIAN_SITE`/`ATLASSIAN_EMAIL`/`ATLASSIAN_API_TOKEN` env vars. The OAuth browser flow needs a TTY and is for humans.
- The OAuth browser flow needs your own registered Atlassian 3LO app; there is no shipped default (see [auth](./auth.md#registering-your-own-oauth-app)).
- Confluence page bodies are raw storage-format XHTML (or Atlas Doc Format via `--format adf`); markdown is NOT converted.
- `confluence-axi page update` is a full-body replace guarded against dropping embedded macros/whiteboards. It cannot create or edit diagrams/whiteboards, only preserve them.
- Bodies truncate by default; pass `--full` on `page get`.
- Per-command help is always available and scoped to the subcommand you name: `confluence-axi page get --help` (see [commands](./commands.md)).

## Sunset note

`confluence-axi` is the Confluence successor to the combined `atlassian-axi` CLI, which is now sunset and split into two per-product bins.
This package is the Confluence half; the Jira half is `jira-axi`.
