# atlassian-axi

Agent-ergonomic Atlassian CLI: **Jira** via Atlassian's official [`acli`](https://developer.atlassian.com/cloud/acli/) and **Confluence** via the Confluence Cloud REST API directly. A member of the AXI tool family (alongside `gh-axi`) — token-efficient [TOON](https://toonformat.dev) output, contextual next-step suggestions, idempotent mutations, and agent SessionStart hooks.

> **Status: Phase 3 (MVP complete).** The dashboard, `auth`, the acli-backed `jira` family, the direct-REST `confluence` family, `setup hooks`, and the inherited `update` command all work today.

## Install

```
npx -y atlassian-axi        # dashboard
```

## Usage

```
atlassian-axi                 # no-arg dashboard (also the session-hook target)
atlassian-axi --help          # global flags + commands
atlassian-axi auth login      # one credential for both halves (token via stdin)
atlassian-axi jira workitem list --project TEAM
atlassian-axi confluence search "space = ENG AND type = page"
atlassian-axi setup hooks     # install SessionStart ambient context
atlassian-axi update          # self-update (inherited from axi-sdk-js)
```

Global flags come **after** the command: `--site <site>` (or the `ATLASSIAN_SITE` env var), `--help`, `-v`/`--version`.

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
