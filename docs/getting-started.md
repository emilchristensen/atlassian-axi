# Getting started

`atlassian-axi` is an agent-ergonomic CLI wrapping Atlassian `acli` for Jira and the Confluence Cloud REST API for Confluence.

Use this doc to install, authenticate, and run your first commands.
For exhaustive flags see [auth](./auth.md), [jira](./jira.md), [confluence](./confluence.md), and [limitations](./limitations.md).

## Install

No global install is needed.
Run any command through `npx`:

```bash
npx -y atlassian-axi <command>
```

## Prerequisites

- Node >= 20.
- `acli` (Atlassian CLI) is required for the Jira half only.
  Install it with `brew install acli`.
  The Confluence half calls the REST API directly and needs nothing extra.

The Jira half shells out to `acli` and rides its credential.
`auth login --token` bootstraps `acli`; the OAuth flow cannot, because `acli` needs an API token.
If `acli` is not installed, Jira commands error and Confluence commands still work.

## Auth quickstart

Two modes exist.
Resolution order is: `ATLASSIAN_API_TOKEN` env > OAuth session > stored API token.
See [auth](./auth.md) for depth.

### API-token mode (agents / CI)

Use this mode for agents and CI.
It is non-interactive and the token is read from stdin only, never as an argument.

```bash
echo -n "$TOKEN" | atlassian-axi auth login --token --site acme.atlassian.net --email me@acme.com
```

`--site` falls back to `ATLASSIAN_SITE` then the stored value.
`--email` falls back to `ATLASSIAN_EMAIL` then the stored value.

Env-var alternative (no `auth login` needed; highest precedence):

```bash
export ATLASSIAN_SITE=acme.atlassian.net
export ATLASSIAN_EMAIL=me@acme.com
export ATLASSIAN_API_TOKEN=<token>
```

### OAuth mode (humans)

`auth login` with no `--token` runs an OAuth 2.0 browser flow.
It requires an interactive TTY and fails fast otherwise, so it is not for agents or CI.

```bash
atlassian-axi auth login
```

It opens `auth.atlassian.com`, catches the `http://localhost:8765/callback` redirect, and stores tokens plus `cloudId` in the 0600 config.
`--site <site>` pre-selects among multiple sites.
Tokens auto-refresh.

## First commands

Dashboard (no args) - ambient snapshot of your Atlassian context:

```bash
atlassian-axi
```

Check auth (see below):

```bash
atlassian-axi auth status
```

List your Jira work items on a project (see [jira](./jira.md)):

```bash
atlassian-axi jira workitem list --project TEAM
```

Search Confluence with CQL (see [confluence](./confluence.md)):

```bash
atlassian-axi confluence search "space = ENG"
```

All structured output is TOON-encoded and token-efficient.

## `atlassian-axi setup hooks`

Installs or repairs agent SessionStart hooks that emit `atlassian-axi` ambient context.

```bash
atlassian-axi setup hooks
```

It writes SessionStart hooks for Claude Code (`~/.claude/settings.json`), Codex (`~/.codex/`), and OpenCode.
Each hook invokes the bin with no args, so the dashboard output becomes the agent's session-start context block.
An agent wants this so every session opens with current Atlassian context without an explicit call.

## Verify it works

```bash
atlassian-axi auth status
```

`auth status` reports the active mode, token expiry, and both halves separately (the `acli` half and the Confluence REST half).

Then confirm live access with the dashboard:

```bash
atlassian-axi
```
