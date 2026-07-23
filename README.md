# atlassian-axi (monorepo)

Agent-ergonomic Atlassian CLIs, split into two focused, independently published packages. Members of the AXI tool family (alongside `gh-axi`): token-efficient [TOON](https://toonformat.dev) output, contextual next-step suggestions, idempotent mutations, and agent SessionStart hooks.

> **`atlassian-axi` (the single combined package) is sunset.** It is no longer published. Use the two packages below instead.

## Packages

| Package | What it is | Auth |
| --- | --- | --- |
| [`jira-axi`](./packages/jira-axi) | Jira CLI backed by Atlassian's [`acli`](https://developer.atlassian.com/cloud/acli/). Commands: `workitem`, `project`, `board`, `sprint`, `filter`, `dashboard`, `field`. | None of its own - delegates entirely to acli's own `acli jira auth login`. Self-contained, no credential setup. |
| [`confluence-axi`](./packages/confluence-axi) | Confluence Cloud CLI over the REST API directly. Commands: `page`, `space`, `search`. | OAuth 3LO (bring your own app) or API token. |

Install globally so each bin is on `PATH` (recommended - `setup hooks` needs a stable, resolvable command):

```
npm i -g jira-axi
npm i -g confluence-axi

jira-axi workitem list --project TEAM
confluence-axi search "space = ENG AND type = page"
```

For a one-off command you can run `npx -y jira-axi <command>` without installing, but that is NOT recommended when you use `setup hooks`: the SessionStart hooks target a bare bin on `PATH`, which `npx` does not provide.

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
pnpm run build:skill # regenerates each packages/<pkg>/skills/<pkg>/SKILL.md from src/skill.ts
```

`SKILL.md` is generated - never hand-edit it. Change `src/skill.ts` and re-run `build:skill`.
`pnpm run build:skill -- --check` fails on drift instead of writing, and CI runs it, so a hand-edit or a forgotten regeneration is caught there.

Per-package work: `pnpm --filter jira-axi <script>` / `pnpm --filter confluence-axi <script>`.

See [AGENTS.md](./AGENTS.md) for project-intrinsic conventions.

## Why it was split

`jira-axi` needs no credential machinery of its own (acli owns Jira auth), so it ships as a fully self-contained app with zero auth setup. `confluence-axi` carries the OAuth/REST auth that only the Confluence half needs. Splitting keeps the Jira tool lean and lets each release independently; the shared framework lives once in `@atlassian-axi/core` and is bundled in, so there is no code duplication.

## License

MIT
