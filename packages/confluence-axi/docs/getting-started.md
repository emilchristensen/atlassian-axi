# Getting started

`confluence-axi` is an agent-ergonomic CLI for Confluence Cloud, calling the Confluence REST API directly.

Use this doc to install, authenticate, and run your first commands.
For exhaustive flags see [commands](./commands.md), [auth](./auth.md), and [limitations](./limitations.md).

## Quick Start

Install the confluence-axi skill in the Agent Skills format with npx skills:

```bash
npx -y skills@latest add emilchristensen/atlassian-axi --skill confluence-axi -g
```

That is the entire setup - no npm install needed.
The skill teaches your agent to run confluence-axi through `npx -y confluence-axi@latest`, so the CLI comes along on demand.
You still need credentials for your Confluence Cloud site - an API token (see [Auth quickstart](#auth-quickstart)) or an OAuth session - and Node >= 20.

The skill is not a user-facing slash command (`user-invocable: false`).
Its frontmatter also includes Hermes Agent metadata (`metadata.hermes`) so Hermes can categorize it as a productivity skill tagged for Atlassian, Confluence, and REST.
Just ask for anything that touches Confluence - reading a page by id, writing or editing page content, finding pages with CQL, listing a page's children, labels, or attachments, browsing spaces, or checking Confluence auth - and the agent loads the skill on its own when it recognizes the task.

`-g` installs the skill user-level for all projects; drop it to install for the current project only (`./.agents/skills/`, symlinked into each agent's own skill directory).

## Other Ways to Install

The skill is the recommended path, but it is not the only one.

### Zero setup

confluence-axi is an AXI, so any capable agent can run the CLI directly with nothing installed at all.
Just tell your agent:

```
Execute `npx -y confluence-axi@latest` to get Confluence tools.
```

The `@latest` pin ensures you always run the newest published version.

### Session hook

Want ambient Confluence context - the resolved site, auth state, and reachable spaces - fed into every agent session instead of loading on demand?
Install the CLI globally and opt into the hook:

```bash
npm install -g confluence-axi
confluence-axi setup hooks
```

This installs a SessionStart hook for Claude Code, Codex, and OpenCode that invokes the installed bin with no args at the start of each session, adding:

- `site: <site>` - which Confluence site the credential currently targets.
- `auth: ok (<mode>)` - the active auth mode and whether it actually works, before you run a command that needs it.
- `spaces[N]{key,name,type,id}` - the spaces the account can reach, with the keys and ids other commands take as arguments.
- `help[N]` - a contextual line naming the available commands.

Restart your agent session after running this so the new hook takes effect.
For global installs, run `confluence-axi update --check` to see whether a newer release is available, or `confluence-axi update` to upgrade.

Every command below works identically under `npx`.

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

The dashboard emits the resolved `site`, the `auth` state, a `count:` line, and the first few `spaces[N]{key,name,type,id}` rows.
Those space keys are directly usable as `page create --space <KEY>` and `search "space = KEY"`, so a session that already has the dashboard block does not need a follow-up `space list` for them.

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
