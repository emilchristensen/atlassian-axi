import { DESCRIPTION } from "./cli.js";

/**
 * Single source of truth for the installable SKILL.md. Generated (never edited
 * by hand) via `pnpm run build:skill` so the skill can never drift from what
 * the CLI actually is.
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

The dashboard, \`auth\`, the acli-backed \`jira\` family, the direct-REST \`confluence\` family, \`setup hooks\`, and the inherited \`update\` command work today.
The Jira half shells out to \`acli\` — install it first (\`brew install acli\`) and run \`auth login\` once.
The Confluence half calls the Cloud REST API directly with the same credential — no extra setup.

## Commands

\`\`\`
commands[5]:
  (none)=dashboard, auth, jira, confluence, setup
jira workitem:
  list, view <KEY> [--fields <a,b,c>], create, edit <KEY>, transition <KEY> --to <status>, assign <KEY> --assignee <user>, comment <KEY> --body <text>, search "<JQL>"
jira project:
  list, view <KEY>
jira board:
  list, view <ID>, list-sprints <ID>, list-projects <ID>
jira sprint:
  view <ID>, list-workitems <ID> --board <ID>, create --board <ID> --name <text>, update <ID>
jira filter:
  list, search, view <ID>, update <ID>
jira dashboard:
  list
jira field:
  create --name <text> --type <key>, update <ID>, delete <ID>, restore <ID>
confluence page:
  get <id>, create --space <KEY> --title <text> --body-file <path>, update <id>, delete <id>, attachments <id>, labels <id> [--add|--remove <name,name,...>], children <id>
confluence space:
  list
confluence:
  search "<CQL>"
\`\`\`

Run \`npx -y atlassian-axi --help\` for global flags, or \`npx -y atlassian-axi <command> --help\` for per-command usage.
Run \`npx -y atlassian-axi setup hooks\` to install SessionStart ambient context.

## Tips

- Output is TOON-encoded and token-efficient.
- Mutations are idempotent and report what changed; re-running a failed mutation is safe (\`transition\` to the current status is a no-op success).
- \`view <KEY> --full\` shows complete bodies; \`--comments\` includes comments; \`--fields <a,b,c>\` renders only those fields (works on list/search/view).
- \`workitem list\` builds JQL from --project/--assignee/--status; pass --jql or use \`search\` for raw JQL.
- Boards/sprints/filters are ID-addressed: find board IDs via \`jira board list\`, sprint IDs via \`jira board list-sprints <BOARD_ID>\`.
- \`sprint list-workitems\` needs both the sprint ID and --board (a Jira agile API requirement).
- \`sprint update <ID> --state closed\` closes a sprint (no-op success when already closed); acli has no field list/view, so \`jira field\` covers custom-field create/update/delete/restore only.
- \`confluence page update\` handles the version bump automatically; re-running after a conflict is safe.
- \`confluence search\` uses v1 CQL (the v2 API has no search); page bodies are storage-format XHTML (\`--format adf\` for Atlas Doc Format).
- \`confluence page labels <id> --add/--remove\` is idempotent: already-present/absent names are reported, and the full post-mutation label set is rendered.
- \`confluence page attachments <id>\` is read-only (filter with --filename/--media-type); upload attachments in the Confluence UI.
`;
}
