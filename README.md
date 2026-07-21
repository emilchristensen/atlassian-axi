# atlassian-axi (monorepo)

Agent-ergonomic Atlassian CLIs, split into two focused, independently published packages. Members of the AXI tool family (alongside `gh-axi`): token-efficient [TOON](https://toonformat.dev) output, contextual next-step suggestions, idempotent mutations, and agent SessionStart hooks.

> **`atlassian-axi` (the single combined package) is sunset.** It is no longer published. Use the two packages below instead.

## Packages

| Package | What it is | Auth |
| --- | --- | --- |
| [`jira-axi`](./packages/jira-axi) | Jira CLI backed by Atlassian's [`acli`](https://developer.atlassian.com/cloud/acli/). Commands: `workitem`, `project`, `board`, `sprint`, `filter`, `dashboard`, `field`. | None of its own - delegates entirely to acli's own `acli jira auth login`. Self-contained, no credential setup. |
| [`confluence-axi`](./packages/confluence-axi) | Confluence Cloud CLI over the REST API directly. Commands: `page`, `space`, `search`. | OAuth 3LO (bring your own app) or API token. |

```
npx -y jira-axi workitem list --project TEAM
npx -y confluence-axi search "space = ENG AND type = page"
```

Commands are flattened per CLI: `jira-axi workitem list` (not `jira-axi jira workitem list`), `confluence-axi page get <id>`.

## Layout

```
packages/
  core/            # @atlassian-axi/core - private shared framework (TOON, args,
                   #   body, format, suggestion + error engines, shared plumbing).
                   #   Bundled into each CLI at build; never published.
  jira-axi/        # published: jira-axi
  confluence-axi/  # published: confluence-axi
```

Turborepo + pnpm workspaces. Each CLI is built with `tsup`, which inlines `@atlassian-axi/core`, so every published package is self-contained (only `axi-sdk-js` stays an external runtime dependency).

## Development

```
pnpm install
pnpm run build       # turbo -> tsc (core) + tsup (clis)
pnpm run typecheck
pnpm test            # turbo -> vitest per package
pnpm run lint
```

Per-package work: `pnpm --filter jira-axi <script>` / `pnpm --filter confluence-axi <script>`.

See [AGENTS.md](./AGENTS.md) for project-intrinsic conventions.

## Why it was split

`jira-axi` needs no credential machinery of its own (acli owns Jira auth), so it ships as a fully self-contained app with zero auth setup. `confluence-axi` carries the OAuth/REST auth that only the Confluence half needs. Splitting keeps the Jira tool lean and lets each release independently; the shared framework lives once in `@atlassian-axi/core` and is bundled in, so there is no code duplication.

## License

MIT
