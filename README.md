# atlassian-axi

Agent-ergonomic Atlassian CLI: **Jira** via Atlassian's official [`acli`](https://developer.atlassian.com/cloud/acli/) and **Confluence** via the Confluence Cloud REST API directly. A member of the AXI tool family (alongside `gh-axi`) - token-efficient [TOON](https://toonformat.dev) output, contextual next-step suggestions, idempotent mutations, and agent SessionStart hooks.

> **Built for agents.** The dashboard, `auth`, the acli-backed `jira` family, the direct-REST `confluence` family, `setup hooks`, and the inherited `update` command all work today.

## Documentation

Full command reference lives in [`docs/`](./docs/), written agent-first:

- [Getting started](./docs/getting-started.md) - install, prerequisites, auth quickstart, first commands.
- [Auth](./docs/auth.md) - credential modes, resolution order, `--site`, OAuth threat model.
- [Jira](./docs/jira.md) - `workitem`, `project`, `board`, `sprint`, `filter`, `dashboard`, `field`.
- [Confluence](./docs/confluence.md) - `page`, `space`, `search`.
- [Setup & update](./docs/setup-and-update.md) - session hooks and self-update.
- [Limitations](./docs/limitations.md) - what the tool deliberately cannot do (no diagram creation/editing, no attachment upload, and more).

## Install

Agents do not need a global install:

```
npx -y atlassian-axi <command>
```

Or run the dashboard directly:

```
npx -y atlassian-axi        # dashboard
```

## Usage

```
atlassian-axi                 # no-arg dashboard (also the session-hook target)
atlassian-axi --help          # global flags + commands
atlassian-axi auth login      # OAuth browser login (humans; tokens auto-refresh)
atlassian-axi jira workitem list --project TEAM
atlassian-axi confluence search "space = ENG AND type = page"
atlassian-axi setup hooks     # install SessionStart ambient context
atlassian-axi update          # self-update (inherited from axi-sdk-js)
```

Global flags come **after** the command: `--site <site>` (or the `ATLASSIAN_SITE` env var), `--help`, `-v`/`--version`.

## Auth

Two modes, resolved in this order: `ATLASSIAN_API_TOKEN` env > OAuth session > stored API token.

**OAuth (default, humans).** `atlassian-axi auth login` opens the browser to `auth.atlassian.com`, catches the `http://localhost:8765/callback` redirect, and stores the rotating tokens + cloud id in the 0600 config file (`~/.config/atlassian-axi/config.json`).
Access tokens refresh transparently on expiry.
The app's client secret comes from `ATLASSIAN_AXI_OAUTH_CLIENT_SECRET` or is prompted once on first login and stored in the same 0600 file.
The flow needs an interactive terminal; without a TTY it fails fast and points at `--token`.

**API token (agents/CI).** `echo -n "$TOKEN" | atlassian-axi auth login --token --site acme.atlassian.net --email me@acme.com` - the token is stdin-only, never argv.
Env vars `ATLASSIAN_SITE` / `ATLASSIAN_EMAIL` / `ATLASSIAN_API_TOKEN` work without any login.

The Jira half rides acli's own credential: `auth login --token` bootstraps it, the OAuth flow cannot (acli needs an API token) - `auth status` reports both halves honestly.

**OAuth threat model, honestly.** Atlassian 3LO has no public-client/PKCE option, so a CLI's "confidential" client secret is hand-distributed and effectively public - it is not load-bearing for security here.
The actual defenses are the loopback-only callback listener (127.0.0.1/::1), the single-use unguessable `state` parameter (constant-time checked; requests without it cannot complete or cancel a login), and the 0600 on-disk token store.
For a stronger posture, register your own 3LO app and point `ATLASSIAN_AXI_OAUTH_CLIENT_ID` / `ATLASSIAN_AXI_OAUTH_CLIENT_SECRET` at it.
The OAuth token only ever drives the Confluence half, and only the Confluence scopes (plus `offline_access`) are requested - the app's granted Jira scopes are deliberately not asked for.

## Development

```
pnpm install
pnpm run build     # tsc → dist/
pnpm test          # vitest
pnpm run lint      # eslint
pnpm run dev       # run from source via tsx
```

See [AGENTS.md](./AGENTS.md) for project-intrinsic conventions (TOON mapping, session hooks, release flow).

## License

MIT
