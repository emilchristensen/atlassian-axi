# auth

Manage the single Atlassian credential that `atlassian-axi` uses for both Jira (via acli) and Confluence (via REST).

Use these commands to log in, inspect the active credential, or clear it.
There are two auth modes: an OAuth 2.0 browser flow (default `auth login`) and an API-token flow (`auth login --token`, for agents/CI).

## Auth modes

**OAuth (3LO) browser flow** - the default `auth login`.
Uses Bearer tokens against `api.atlassian.com`, auto-refreshed.
Requires an interactive TTY; fails fast with `VALIDATION_ERROR` when stdin/stdout is not a terminal.
Cannot bootstrap acli, so the Jira half is unavailable in pure OAuth mode.

**API token** - `auth login --token`.
Stores site + email + API token for headless use.
The token is read from stdin only, never passed as an argument.
Bootstraps acli, so both the Jira and Confluence halves work.

## Credential resolution order

`ATLASSIAN_API_TOKEN` env > stored OAuth session > stored API token.

A half-configured env token (env var set but incomplete) resolves to a loud `none`, never a silent OAuth fallback.

## Environment variables

- `ATLASSIAN_SITE` - site host, e.g. `mysite.atlassian.net`.
- `ATLASSIAN_EMAIL` - account email.
- `ATLASSIAN_API_TOKEN` - API token; when set, takes precedence over any stored credential.
- `ATLASSIAN_AXI_NO_KEYCHAIN=1` - force the file-based credential store, bypassing the OS keychain.
- `ATLASSIAN_AXI_OAUTH_CLIENT_ID` - override the shipped OAuth client id.
- `ATLASSIAN_AXI_OAUTH_CLIENT_SECRET` - supply the OAuth client secret via env; env-supplied secrets are never persisted.

## Credential storage

Storage precedence for the API-token credential is: env > keychain > `0600` config file.
The config file lives at `~/.config/atlassian-axi/config.json` and honours `XDG_CONFIG_HOME`.
It is written mode `0600` (owner read/write only).

The OAuth session (tokens + cloudId + site + optionally the client secret) is stored whole in the `0600` config file under `oauth:`, NOT the keychain.
The OAuth session and the API-token credential coexist; all writes merge and never clobber the other.

## `atlassian-axi auth login`

OAuth 2.0 browser login.
Opens `auth.atlassian.com`, catches the `http://localhost:8765/callback` redirect, and stores tokens + cloudId in the `0600` config.

**Flags:**
- `--site <site>` - pre-select among multiple accessible sites (optional; e.g. `mysite.atlassian.net`).

```bash
atlassian-axi auth login
```

**Caveats:**
- Requires an interactive TTY.
Fails with `VALIDATION_ERROR` when stdin/stdout is not a terminal - use `--token` for agents/CI.
- The callback is pinned to `http://localhost:8765/callback`; port 8765 must be free during login.
- Client secret resolution: `ATLASSIAN_AXI_OAUTH_CLIENT_SECRET` env, otherwise prompted once (hidden, on stderr) and stored in the `0600` config.
- OAuth cannot bootstrap acli, so the Jira half stays unconfigured in this mode; `auth status` reports it separately.

## `atlassian-axi auth login --token`

API-token login for agents/CI.
No browser.
Persists the credential to the store, then status-gates `acli jira auth status` before bootstrapping `acli jira auth login`.

**Flags:**
- `--token` (required) - selects API-token mode; the token itself is read from stdin, never as an argument.
- `--site <site>` - site host (optional; falls back to `ATLASSIAN_SITE` then stored value).
- `--email <email>` - account email (optional; falls back to `ATLASSIAN_EMAIL` then stored value).

```bash
echo -n "$TOKEN" | atlassian-axi auth login --token --site acme.atlassian.net --email me@acme.com
```

**Caveats:**
- The token MUST arrive on stdin; reading from a TTY throws.
- Bootstraps acli from the stored credential, enabling the Jira half.

## `atlassian-axi auth status`

Report the active mode, token expiry, and both halves (acli + Confluence REST) separately.

```bash
atlassian-axi auth status
```

**Caveats:**
- In OAuth mode the acli half is reported honestly (typically unconfigured) but the overall ok/degraded verdict gates only on the Confluence REST ping.
- Read-only; safe to run repeatedly.

## `atlassian-axi auth logout`

Clear the OAuth tokens and the API credential/keychain entry, and log acli out.

```bash
atlassian-axi auth logout
```

**Caveats:**
- Clears every stored credential half.
Idempotent - safe to run when nothing is configured.

## OAuth token refresh

Atlassian rotates refresh tokens on every refresh.
The session refreshes proactively on expiry (60s skew) and performs exactly one forced refresh + retry on a 401.
Each refresh persists the newest refresh token to the `0600` store.

## `--site` retargeting

`--site <site>` feeds credential resolution (flag > env > stored) and lets you target a different Atlassian instance.

- Only the Confluence half honours `--site`.
- The Jira router throws `VALIDATION_ERROR` when `--site` differs from the stored site (acli is bound to its own login).
- In OAuth mode the transport refuses an override differing from the session site (the cloudId is pinned).
- Atlassian API tokens are account-scoped, so one token serves every instance the account can reach.

See [limitations](./limitations.md) for the full `--site` caveat.

## OAuth threat model

The shipped OAuth app is a confidential client with no PKCE / public-client option, so the bundled client secret is effectively public.
The real defenses are: the loopback-only callback (`http://localhost:8765/callback`), a single-use `state` parameter validated on return, and the `0600` on-disk store.
For a stronger posture, register your own Atlassian OAuth app and supply it via `ATLASSIAN_AXI_OAUTH_CLIENT_ID` and `ATLASSIAN_AXI_OAUTH_CLIENT_SECRET`.
