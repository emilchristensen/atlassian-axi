import { DESCRIPTION } from "./cli.js";

/**
 * Single source of truth for the installable SKILL.md. Generated (never edited
 * by hand) via `pnpm run build:skill` so the skill can never drift from what
 * the CLI actually is.
 */
export function createSkillMarkdown(): string {
  return `---
name: confluence-axi
description: "${DESCRIPTION}"
user-invocable: false
metadata:
  hermes:
    tags: [atlassian, confluence, rest]
    category: productivity
---

# confluence-axi

${DESCRIPTION}

You do not need confluence-axi installed globally — invoke it with \`npx -y confluence-axi <command>\`.

## Status

The dashboard, \`auth\`, the direct-REST \`page\`/\`space\`/\`search\` commands, \`setup hooks\`, and the inherited \`update\` command work today.
Auth has two modes: \`auth login\` runs an OAuth browser flow (humans, interactive terminals; tokens auto-refresh), and \`auth login --token\` takes site + email + API token via stdin (agents/CI — use this one; the OAuth flow fails fast without a TTY).
Resolution order: \`ATLASSIAN_API_TOKEN\` env > OAuth session > stored API token.
OAuth needs your own registered 3LO app: set \`ATLASSIAN_AXI_OAUTH_CLIENT_ID\` (and the client secret via \`ATLASSIAN_AXI_OAUTH_CLIENT_SECRET\` or the one-time prompt).
The CLI calls the Confluence Cloud REST API directly (via \`api.atlassian.com\` in OAuth mode) — no extra setup.

## Commands

\`\`\`
commands[6]:
  (none)=dashboard, auth, page, space, search, setup
page:
  get <id> [--full] [--format storage|adf], create --space <KEY> --title <text> --body-file <path> [--parent <id>], update <id> [--title <text>] [--body-file <path>] [--allow-macro-loss], delete <id>, attachments <id>, labels <id> [--add|--remove <name,name,...>], children <id>
space:
  list [--limit <n>] [--fields <a,b,c>]
search:
  search "<CQL>" [--limit <n>] [--fields <a,b,c>]  (v1 CQL — the v2 API has no search endpoint)
\`\`\`

Run \`npx -y confluence-axi --help\` for global flags, or \`npx -y confluence-axi <command> --help\` for per-command usage.
Run \`npx -y confluence-axi setup hooks\` to install SessionStart ambient context.

## Tips

- Output is TOON-encoded and token-efficient.
- Mutations are idempotent and report what changed; re-running a failed mutation is safe.
- \`page get <id> --full\` shows the complete body without truncation; \`--format adf\` returns Atlas Doc Format instead of storage-format XHTML.
- \`page create/update\` take raw storage-format XHTML bodies (\`--body\` or \`--body-file\`), NOT markdown; \`--format adf\` on \`get\` is read-only.
- \`page update\` is a FULL-body replace (version bump is automatic; re-running after a conflict is safe). It refuses by default when the new body drops a macro/embed the current page has (e.g. an embedded whiteboard/diagram) — to keep it, \`page get <id> --full\` first and carry the \`<ac:structured-macro …>\` block into your new body; pass --allow-macro-loss only to drop it intentionally.
- \`--fields <a,b,c>\` on \`search\`/\`space list\` trims or widens the rendered row schema (the id/key column is always kept).
- \`search\` uses v1 CQL (the v2 API has no search); use it to find page ids to feed \`page get\`.
- \`page labels <id> --add/--remove\` is idempotent and manages global-prefix labels only: already-present/absent names are reported, and the full post-mutation label set is rendered.
- \`page attachments <id>\` is read-only (filter with --filename/--media-type); upload attachments in the Confluence UI.
- \`--site <site>\` (after the command) retargets the request to another instance the account can reach; an account-scoped API token serves every reachable instance.
`;
}
