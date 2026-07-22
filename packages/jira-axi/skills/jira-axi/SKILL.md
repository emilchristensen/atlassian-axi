---
name: jira-axi
description: "Agent-ergonomic Jira CLI, backed by Atlassian's acli. Token-efficient TOON output, contextual suggestions, idempotent mutations. Self-contained: auth is delegated to acli's own login, no extra credential setup."
user-invocable: false
metadata:
  hermes:
    tags: [atlassian, jira, acli]
    category: productivity
---

# jira-axi

Agent-ergonomic Jira CLI, backed by Atlassian's acli. Token-efficient TOON output, contextual suggestions, idempotent mutations. Self-contained: auth is delegated to acli's own login, no extra credential setup.

You do not need jira-axi installed globally — invoke it with `npx -y jira-axi <command>`.

## Status

The dashboard, the acli-backed Jira commands (`workitem`, `project`, `board`, `sprint`, `filter`, `dashboard`, `field`), `setup hooks`, and the inherited `update` command work today.
jira-axi shells out to Atlassian's `acli` — install it first (`brew install acli`) and log in with `acli jira auth login`.
There is no separate credential setup: auth is delegated entirely to acli's own login.

## Commands

```
commands[9]:
  (none)=dashboard, workitem, project, board, sprint, filter, dashboard, field, setup
workitem:
  list, view <KEY> [--fields <a,b,c>], create, edit <KEY>, transition <KEY> --to <status>, assign <KEY> --assignee <user>, comment <KEY> --body <text>, search "<JQL>"
project:
  list, view <KEY>
board:
  list, view <ID>, list-sprints <ID>, list-projects <ID>
sprint:
  view <ID>, list-workitems <ID> --board <ID>, create --board <ID> --name <text>, update <ID>
filter:
  list, search, view <ID>, update <ID>
dashboard:
  list
field:
  create --name <text> --type <key>, update <ID>, delete <ID>, restore <ID>
```

Run `npx -y jira-axi --help` for global flags, or `npx -y jira-axi <command> --help` for per-command usage.
Run `npx -y jira-axi setup hooks` to install SessionStart ambient context.

## Tips

- Output is TOON-encoded and token-efficient.
- Mutations are idempotent and report what changed; re-running a failed mutation is safe (`transition` to the current status is a no-op success).
- `view <KEY> --full` shows complete bodies; `--comments` includes comments (count line reports the true total; raise the shown rows with `--limit <n>`); `--fields <a,b,c>` renders only those fields (works on list/search/view).
- Long free text is truncated with a size marker and a `--full` escape hatch: `workitem view` bodies/comments, `filter view` and `project view` descriptions.
- `workitem list` builds JQL from --project/--assignee/--status; pass --jql or use `search` for raw JQL.
- `workitem create/edit --body` and `comment --body` accept markdown (headings, lists, inline/block code, bold/italic, links) and store it as real Jira ADF; raw ADF JSON is passed through unchanged.
- Boards/sprints/filters are ID-addressed: find board IDs via `board list`, sprint IDs via `board list-sprints <BOARD_ID>`.
- `sprint list-workitems` needs both the sprint ID and --board (a Jira agile API requirement).
- `sprint update <ID> --state closed` closes a sprint (no-op success when already closed); acli has no field list/view, so `field` covers custom-field create/update/delete/restore only.
