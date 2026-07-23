# Getting started

`confluence-axi` is an agent-ergonomic CLI for Confluence Cloud, calling the Confluence REST API directly.

Use this doc to install, authenticate, and run your first commands.
For exhaustive flags see [commands](./commands.md), [auth](./auth.md), and [limitations](./limitations.md).

## Install

Install globally so a stable `confluence-axi` bin lands on your `PATH` (recommended):

```bash
npm i -g confluence-axi
```

A global install is what `setup hooks` needs: the SessionStart hooks it writes call a bare `confluence-axi` command with no args, which only resolves when the bin is on `PATH`.

For a one-off command you can run `npx -y confluence-axi <command>` without installing, but that is NOT recommended when you use `setup hooks` - `npx` does not give the hooks a stable command to call.

## Prerequisites

- Node >= 20.
- Nothing else. The Confluence half calls the REST API directly and needs no `acli`.

## Auth quickstart

Two modes exist.
Resolution order is: `ATLASSIAN_API_TOKEN` env > OAuth session > stored API token.
See [auth](./auth.md) for depth.

### API-token mode (agents / CI)

Use this mode for agents and CI.
It is non-interactive and the token is read from stdin only, never as an argument.

```bash
echo -n "$TOKEN" | confluence-axi auth login --token --site acme.atlassian.net --email me@acme.com
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
It also requires your own registered OAuth app (see [Registering your own OAuth app](./auth.md#registering-your-own-oauth-app)); there is no shipped default.

```bash
export ATLASSIAN_AXI_OAUTH_CLIENT_ID=<your app client id>
export ATLASSIAN_AXI_OAUTH_CLIENT_SECRET=<your app client secret>   # or omit and paste when prompted
confluence-axi auth login
```

It opens `auth.atlassian.com`, catches the `http://localhost:8765/callback` redirect, and stores tokens plus `cloudId` in the 0600 config.
When you have access to more than one site and do not pass `--site`, it lists your accessible sites and prompts you to pick one.
Tokens auto-refresh.

## First commands

Dashboard (no args) - ambient snapshot of your Confluence context:

```bash
confluence-axi
```

Search Confluence with CQL (see [commands](./commands.md)):

```bash
confluence-axi search "space = ENG"
```

Fetch a page by id:

```bash
confluence-axi page get 12345 --full
```

List spaces:

```bash
confluence-axi space list
```

All structured output is TOON-encoded and token-efficient.

## `confluence-axi setup hooks`

Installs or repairs agent SessionStart hooks that emit `confluence-axi` ambient context.

```bash
confluence-axi setup hooks
```

It writes SessionStart hooks for Claude Code (`~/.claude/settings.json`), Codex (`~/.codex/`), and OpenCode.
Each hook invokes the bin with no args, so the dashboard output becomes the agent's session-start context block.
An agent wants this so every session opens with current Confluence context without an explicit call.
See [setup & update](./setup.md).

## Verify it works

```bash
confluence-axi auth status
```

`auth status` reports the active mode, token expiry, and the Confluence REST half.

Then confirm live access with the dashboard:

```bash
confluence-axi
```
