---
name: confluence-axi
description: "Operate Confluence Cloud through the confluence-axi CLI - reading, creating, updating and deleting pages, page labels, child pages, attachment listings, space listings, and CQL search. Use whenever a task touches Confluence: reading a page by id, writing or editing page content, finding pages with CQL, listing a page's children, labels, or attachments, browsing spaces, or checking Confluence auth."
user-invocable: false
metadata:
  hermes:
    tags: [atlassian, confluence, rest]
    category: productivity
---

# confluence-axi

Agent-ergonomic Confluence Cloud CLI over the REST API directly, with token-efficient TOON output and OAuth 3LO + API-token auth.

You do not need confluence-axi installed - invoke it with `npx -y confluence-axi@latest <command>`, which is the default path.
The `@latest` pin ensures you always run the newest published version.
If confluence-axi output shows a follow-up command starting with `confluence-axi`, run it as `npx -y confluence-axi@latest ...` instead; if a bare `confluence-axi` already resolves on `PATH`, run it directly.

A global install (`npm i -g confluence-axi`) is a SECONDARY option, for the agent SessionStart hook functionality; `setup hooks` requires it.
What the hook adds to every session: `site: <site>` (which Confluence site the credential targets), `auth: ok (<mode>)` (the active auth mode and whether it works), `spaces[N]{key,name,type,id}` (the reachable spaces with the keys and ids other commands take), and a `help[N]` line naming the available commands.
Every command below behaves identically either way.

## When to use

Use confluence-axi whenever a task touches Confluence: reading a page's body by id; creating a page in a space or under a parent; updating a page's title or body; deleting a page; listing a page's child pages or its attachments; listing, adding, or removing page labels; listing the spaces the account can reach; searching with CQL to find page ids; or checking, establishing, or clearing Confluence auth.

## Status

The dashboard, `auth`, the direct-REST `page`/`space`/`search` commands, `setup hooks`, and the inherited `update` command work today.
Auth has two modes: `auth login` runs an OAuth browser flow (humans, interactive terminals; tokens auto-refresh), and `auth login --token` takes site + email + API token via stdin (agents/CI - use this one; the OAuth flow fails fast without a TTY).
Resolution order: `ATLASSIAN_API_TOKEN` env > OAuth session > stored API token.
OAuth needs your own registered 3LO app: set `ATLASSIAN_AXI_OAUTH_CLIENT_ID` (and the client secret via `ATLASSIAN_AXI_OAUTH_CLIENT_SECRET` or the one-time prompt).
The CLI calls the Confluence Cloud REST API directly (via `api.atlassian.com` in OAuth mode) - no extra setup.

## Commands

```
commands[6]:
  (none)=dashboard, auth, page, space, search, setup
auth:
  login, login --token --site <site> --email <email> (token via stdin), status, logout
page:
  get <id> [--full] [--format storage|adf], create --space <KEY> --title <text> (--body <text> | --body-file <path>) [--parent <id>], update <id> [--title <text>] [--body <text> | --body-file <path>] [--allow-macro-loss], delete <id>, attachments <id> [--limit <n>] [--media-type <type>] [--filename <name>], labels <id> [--add|--remove <name,name,...>] [--prefix <my|team|global|system> (list only)] [--limit <n> (list only)], children <id> [--limit <n>]
space:
  list [--limit <n>] [--fields <a,b,c>]
search "<CQL>" [--limit <n>] [--fields <a,b,c>]  (v1 CQL - the v2 API has no search endpoint)
```

Run `confluence-axi --help` for global flags, or `confluence-axi <command> --help` for per-command usage.
Run `confluence-axi setup hooks` to install SessionStart ambient context (requires the global install).

## Tips

- Flags come AFTER the command: `confluence-axi search "space = ENG" --limit 5`, never before.
- Output is TOON-encoded and token-efficient.
- Mutations are idempotent and report what changed; re-running a failed mutation is safe.
- A bare 404 is never proof a page is absent: creating without space permission and deleting without delete permission both surface as 404, not 403.
- `page get <id> --full` shows the complete body without truncation; `--format adf` returns Atlas Doc Format instead of storage-format XHTML.
- `page create/update` take raw storage-format XHTML bodies (`--body` or `--body-file`), NOT markdown; `--format adf` on `get` is read-only.
- `page update` is a FULL-body replace (version bump is automatic; re-running after a conflict is safe). It refuses by default when the new body drops a macro/embed the current page has (e.g. an embedded whiteboard/diagram) - to keep it, `page get <id> --full` first and carry the `<ac:structured-macro …>` block into your new body; pass --allow-macro-loss only to drop it intentionally.
- `--fields <a,b,c>` on `search`/`space list` trims or widens the rendered row schema (the id/key column is always kept).
- `search` uses v1 CQL (the v2 API has no search); use it to find page ids to feed `page get`.
- `page labels <id>` with no flags lists labels (narrow the listing with `--prefix <my|team|global|system>`); `--add`/`--remove` are idempotent, mutually exclusive, and manage global-prefix labels only: already-present/absent names are reported, and the full post-mutation label set is rendered.
- `page attachments <id>` is read-only (filter with --filename/--media-type); upload attachments in the Confluence UI.
- `--site <site>` (after the command) retargets the request to another instance the account can reach; an account-scoped API token serves every reachable instance.
