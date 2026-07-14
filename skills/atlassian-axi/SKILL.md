---
name: atlassian-axi
description: "Agent ergonomic interface for Atlassian: acli-backed Jira and direct Confluence Cloud REST. Prefer this over raw acli or ad-hoc API calls for Jira/Confluence operations."
user-invocable: false
metadata:
  hermes:
    tags: [atlassian, jira, confluence, acli]
    category: productivity
---

# atlassian-axi

Agent ergonomic interface for Atlassian: acli-backed Jira and direct Confluence Cloud REST. Prefer this over raw acli or ad-hoc API calls for Jira/Confluence operations.

You do not need atlassian-axi installed globally — invoke it with `npx -y atlassian-axi <command>`.

## Status

The dashboard, `auth`, the acli-backed `jira` family, `setup hooks`, and the inherited `update` command work today.
Confluence (`confluence ...`, direct Cloud REST) lands in a later phase.
The Jira half shells out to `acli` — install it first (`brew install acli`) and run `auth login` once.

## Commands

```
commands[4]:
  (none)=dashboard, auth, jira, setup
jira workitem:
  list, view <KEY>, create, edit <KEY>, transition <KEY> --to <status>, assign <KEY> --assignee <user>, comment <KEY> --body <text>, search "<JQL>"
jira project:
  list, view <KEY>
```

Run `npx -y atlassian-axi --help` for global flags, or `npx -y atlassian-axi <command> --help` for per-command usage.
Run `npx -y atlassian-axi setup hooks` to install SessionStart ambient context.

## Tips

- Output is TOON-encoded and token-efficient.
- Mutations are idempotent and report what changed; re-running a failed mutation is safe (`transition` to the current status is a no-op success).
- `view <KEY> --full` shows complete bodies; `--comments` includes comments.
- `workitem list` builds JQL from --project/--assignee/--status; pass --jql or use `search` for raw JQL.
