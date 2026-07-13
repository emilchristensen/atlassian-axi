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

Phase 0 scaffold. The dashboard, \`setup hooks\`, and the inherited \`update\` command work today.
Jira (\`jira ...\`, acli-backed) and Confluence (\`confluence ...\`, direct Cloud REST) command families land in later phases.

## Commands

\`\`\`
commands[3]:
  (none)=dashboard, jira, confluence, setup
\`\`\`

Run \`npx -y atlassian-axi --help\` for global flags, or \`npx -y atlassian-axi <command> --help\` for per-command usage.
Run \`npx -y atlassian-axi setup hooks\` to install SessionStart ambient context.

## Tips

- Output is TOON-encoded and token-efficient.
- Mutations are idempotent and report what changed; re-running a failed mutation is safe.
`;
}
