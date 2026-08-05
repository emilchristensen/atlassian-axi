---
name: jira-axi
description: "Operate Jira through the jira-axi CLI - work items, JQL search, transitions, assignments, comments, projects, boards, sprints, saved filters, dashboards, and custom fields. Use whenever a task touches Jira: viewing or editing a work item, moving a ticket through its workflow, assigning it, reading or adding comments, searching with JQL, or working with boards, sprints, and filters."
user-invocable: false
metadata:
  hermes:
    tags: [atlassian, jira, acli]
    category: productivity
---

# jira-axi

Agent-ergonomic Jira CLI backed by Atlassian's acli, with token-efficient TOON output and self-contained auth (no extra credential setup).

You do not need jira-axi installed - invoke it with `npx -y jira-axi@latest <command>`, which is the default path.
The `@latest` pin ensures you always run the newest published version.
If jira-axi output shows a follow-up command starting with `jira-axi`, run it as `npx -y jira-axi@latest ...` instead; if a bare `jira-axi` already resolves on `PATH`, run it directly.

A global install (`npm i -g jira-axi`) is a SECONDARY option, for the agent SessionStart hook functionality; `setup hooks` requires it.
What the hook adds to every session: `acli: installed` (whether the required acli prerequisite is present), `my_open_workitems[N]{key,summary,status}` (your own open work items), and a `help[N]` line naming the available commands.
Every command below behaves identically either way.

## When to use

Use jira-axi whenever a task touches Jira: viewing, creating, or editing a work item; transitioning a ticket to another status; assigning or reassigning it; reading or adding comments; searching with JQL or filtering by project, assignee, or status; listing or inspecting projects; working with boards, their sprints, and their projects; creating, updating, or closing a sprint; listing and updating saved filters; listing dashboards; or creating, updating, deleting, or restoring custom fields.

## Status

The dashboard, the acli-backed Jira commands (`workitem`, `project`, `board`, `sprint`, `filter`, `dashboard`, `field`), `setup hooks`, and the inherited `update` command work today.
jira-axi shells out to Atlassian's `acli` - install it first (`brew install acli`) and log in with `acli jira auth login`.
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

Run `jira-axi --help` for global flags, or `jira-axi <command> --help` for per-command usage.
Run `jira-axi setup hooks` to install SessionStart ambient context (requires the global install).

## Tips

- Flags come AFTER the command: `jira-axi workitem list --project TEAM`, never before.
- Output is TOON-encoded and token-efficient.
- Mutations are idempotent and report what changed; re-running a failed mutation is safe (`transition` to the current status is a no-op success).
- `filter list` lists only filters the account OWNS, so `count: 0` is not proof there are none; use `filter list --favourite` or `filter search --name <substring>` to reach the rest.
- `view <KEY> --full` shows complete bodies; `--comments` includes comments (count line reports the true total; raise the shown rows with `--limit <n>`); `--fields <a,b,c>` renders only those fields (works on list/search/view).
- Long free text is truncated with a size marker and a `--full` escape hatch: `workitem view` bodies/comments, `filter view` and `project view` descriptions.
- `workitem list` builds JQL from --project/--assignee/--status; pass --jql or use `search` for raw JQL.
- `workitem create/edit --body` and `comment --body` accept markdown (headings, lists, inline/block code, bold/italic, links) and store it as real Jira ADF; raw ADF JSON is passed through unchanged.
- Boards/sprints/filters are ID-addressed: find board IDs via `board list`, sprint IDs via `board list-sprints <BOARD_ID>`.
- `sprint list-workitems` needs both the sprint ID and --board (a Jira agile API requirement).
- `sprint update <ID> --state closed` closes a sprint (no-op success when already closed); acli has no field list/view, so `field` covers custom-field create/update/delete/restore only.
