import { DESCRIPTION } from "./cli.js";

/**
 * Single source of truth for the installable SKILL.md. Generated (never edited
 * by hand) via `pnpm run build:skill` so the skill can never drift from what
 * the CLI actually is. Kept intentionally small in Phase 0 — command families
 * are documented here as they land.
 */
export function createSkillMarkdown(): string {
  return `---
name: atlassian-axi
description: "${DESCRIPTION}"
user-invocable: false
metadata:
  hermes:
    tags: [atlassian, jira, confluence, acli]
    category: productivity
---

# atlassian-axi

${DESCRIPTION}

You do not need atlassian-axi installed globally — invoke it with \`npx -y atlassian-axi <command>\`.

## Status

The dashboard, \`auth\`, the acli-backed \`jira\` family, \`setup hooks\`, and the inherited \`update\` command work today.
Confluence (\`confluence ...\`, direct Cloud REST) lands in a later phase.
The Jira half shells out to \`acli\` — install it first (\`brew install acli\`) and run \`auth login\` once.

## Commands

\`\`\`
commands[4]:
  (none)=dashboard, auth, jira, setup
jira workitem:
  list, view <KEY>, create, edit <KEY>, transition <KEY> --to <status>, assign <KEY> --assignee <user>, comment <KEY> --body <text>, search "<JQL>"
jira project:
  list, view <KEY>
\`\`\`

Run \`npx -y atlassian-axi --help\` for global flags, or \`npx -y atlassian-axi <command> --help\` for per-command usage.
Run \`npx -y atlassian-axi setup hooks\` to install SessionStart ambient context.

## Tips

- Output is TOON-encoded and token-efficient.
- Mutations are idempotent and report what changed; re-running a failed mutation is safe (\`transition\` to the current status is a no-op success).
- \`view <KEY> --full\` shows complete bodies; \`--comments\` includes comments.
- \`workitem list\` builds JQL from --project/--assignee/--status; pass --jql or use \`search\` for raw JQL.
`;
}
