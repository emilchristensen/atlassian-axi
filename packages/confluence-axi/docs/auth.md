# auth

Manage the Atlassian credential that `confluence-axi` uses for the Confluence REST API.

Use these commands to log in, inspect the active credential, or clear it.
There are two auth modes: an OAuth 2.0 browser flow (default `auth login`) and an API-token flow (`auth login --token`, for agents/CI).

This CLI talks only to Confluence and never bootstraps `acli`.
The Jira half lived in the old combined `atlassian-axi` and is now the separate `jira-axi` bin.

## Auth modes

**OAuth (3LO) browser flow** - the default `auth login`.
Uses Bearer tokens against `api.atlassian.com`, auto-refreshed.
Requires an interactive TTY; fails fast with `VALIDATION_ERROR` when stdin/stdout is not a terminal.
There is no shipped OAuth app: you must register your own Atlassian 3LO app once and set `ATLASSIAN_AXI_OAUTH_CLIENT_ID` (and supply the secret). See [Registering your own OAuth app](#registering-your-own-oauth-app) below.
If you need Confluence non-interactively, prefer the API-token mode.

**API token** - `auth login --token`.
Stores site + email + API token for headless use.
The token is read from stdin only, never passed as an argument.

## Credential resolution order

`ATLASSIAN_API_TOKEN` env > stored OAuth session > stored API token.

A half-configured env token (env var set but incomplete) resolves to a loud `none`, never a silent OAuth fallback.

## Environment variables

- `ATLASSIAN_SITE` - site host, e.g. `mysite.atlassian.net`.
- `ATLASSIAN_EMAIL` - account email.
- `ATLASSIAN_API_TOKEN` - API token; when set, takes precedence over any stored credential.
- `ATLASSIAN_AXI_NO_KEYCHAIN=1` - force the file-based credential store, bypassing the OS keychain.
- `ATLASSIAN_AXI_OAUTH_CLIENT_ID` - client id of your own registered Atlassian OAuth app. Required for OAuth login; there is no shipped default (see [Registering your own OAuth app](#registering-your-own-oauth-app)).
- `ATLASSIAN_AXI_OAUTH_CLIENT_SECRET` - client secret of that app; env-supplied secrets are never persisted. If unset you are prompted once on first login and it is stored in the 0600 config.

## Credential storage

Storage precedence for the API-token credential is: env > keychain > `0600` config file.
The config file lives at `~/.config/atlassian-axi/config.json` and honours `XDG_CONFIG_HOME`.
It is written mode `0600` (owner read/write only).

The OAuth session (tokens + cloudId + site + optionally the client secret) is stored whole in the `0600` config file under `oauth:`, NOT the keychain.
The OAuth session and the API-token credential coexist; all writes merge and never clobber the other.

## `confluence-axi auth login`

OAuth 2.0 browser login.
Opens `auth.atlassian.com`, catches the `http://localhost:8765/callback` redirect, and stores tokens + cloudId in the `0600` config.

**Flags:**
- `--site <site>` - pre-select among multiple accessible sites (optional; e.g. `mysite.atlassian.net`).

```bash
export ATLASSIAN_AXI_OAUTH_CLIENT_ID=<your app client id>
export ATLASSIAN_AXI_OAUTH_CLIENT_SECRET=<your app client secret>   # or omit and paste when prompted
confluence-axi auth login
```

**Caveats:**
- Requires your own registered OAuth app; there is no shipped default. See [Registering your own OAuth app](#registering-your-own-oauth-app).
- Requires an interactive TTY. Fails with `VALIDATION_ERROR` when stdin/stdout is not a terminal - use `--token` for agents/CI.
- The callback is pinned to `http://localhost:8765/callback`; port 8765 must be free during login.
- Client secret resolution: `ATLASSIAN_AXI_OAUTH_CLIENT_SECRET` env, otherwise prompted once (hidden, on stderr) and stored in the `0600` config.
- When you have access to more than one site and do not pass `--site`, it lists your accessible sites and prompts you to pick one.

## `confluence-axi auth login --token`

API-token login for agents/CI.
No browser.
Persists the credential to the store for use against the Confluence REST API.

**Flags:**
- `--token` (required) - selects API-token mode; the token itself is read from stdin, never as an argument.
- `--site <site>` - site host (optional; falls back to `ATLASSIAN_SITE` then stored value).
- `--email <email>` - account email (optional; falls back to `ATLASSIAN_EMAIL` then stored value).

```bash
echo -n "$TOKEN" | confluence-axi auth login --token --site acme.atlassian.net --email me@acme.com
```

**Caveats:**
- The token MUST arrive on stdin; reading from a TTY throws.

## `confluence-axi auth status`

Report the active mode, token expiry, and the Confluence REST half.

```bash
confluence-axi auth status
```

**Caveats:**
- Read-only; safe to run repeatedly.
- The overall ok/degraded verdict gates on the Confluence REST ping.

## `confluence-axi auth logout`

Clear the OAuth tokens and the API credential/keychain entry.

```bash
confluence-axi auth logout
```

**Caveats:**
- Clears every stored credential half.
- Idempotent - safe to run when nothing is configured.

## OAuth token refresh

Atlassian rotates refresh tokens on every refresh.
The session refreshes proactively on expiry (60s skew) and performs exactly one forced refresh + retry on a 401.
Each refresh persists the newest refresh token to the `0600` store.

## `--site` retargeting

`--site <site>` feeds credential resolution (flag > env > stored) and lets you target a different Atlassian instance.

- In OAuth mode the transport refuses an override differing from the session site (the cloudId is pinned).
- Atlassian API tokens are account-scoped, so one token serves every instance the account can reach.

See [limitations](./limitations.md) for the full `--site` caveat.

## Registering your own OAuth app

The OAuth browser flow needs an Atlassian 3LO app that you own.
This CLI ships none on purpose: Atlassian 3LO has no PKCE / public-client option and both its token and refresh grants require the client secret, so a distributed CLI cannot bundle a working app without shipping a secret (insecure) or running a hosted token broker (out of scope).
Registering your own app keeps the client id and secret entirely on your machine, which is Atlassian's own recommended pattern.
This is a one-time setup of a few minutes.

1. Open the [Atlassian developer console](https://developer.atlassian.com/console/myapps/) and create an app: **Create** -> **OAuth 2.0 integration**. Give it any name.
2. **Permissions** -> add the **Confluence API**, then grant these scopes: `read:confluence-content.all`, `write:confluence-content`, `read:confluence-space.summary`, `search:confluence`. (`offline_access` is requested automatically for refresh tokens.)
3. **Authorization** -> configure **OAuth 2.0 (3LO)** and set the **Callback URL** to EXACTLY `http://localhost:8765/callback`.
4. **Settings** -> copy the **Client ID** and generate/copy the **Secret**.
5. Provide them to the CLI as `ATLASSIAN_AXI_OAUTH_CLIENT_ID` and `ATLASSIAN_AXI_OAUTH_CLIENT_SECRET` (env), or set only the id and paste the secret when `auth login` prompts once (it is then stored in the 0600 config, never re-requested).

Notes:
- The callback must match `http://localhost:8765/callback` character-for-character or Atlassian rejects the redirect.
- Only Confluence scopes are requested.
- Env-supplied secrets are never written to disk; a prompted secret is stored in the 0600 config so you are not asked again.

## OAuth threat model

This CLI ships no OAuth app. You register your own Atlassian 3LO app and supply it via `ATLASSIAN_AXI_OAUTH_CLIENT_ID` and `ATLASSIAN_AXI_OAUTH_CLIENT_SECRET`, so the client credentials never leave your machine.
This is deliberate: Atlassian 3LO has no PKCE / public-client option and its token and refresh grants both require the client secret, so a distributed CLI cannot bundle a working app without either shipping a secret (insecure) or operating a hosted token broker (out of scope). Self-registration is Atlassian's own recommended pattern.
The runtime defenses are: the loopback-only callback (`http://localhost:8765/callback`), a single-use `state` parameter validated on return, and the `0600` on-disk store.
