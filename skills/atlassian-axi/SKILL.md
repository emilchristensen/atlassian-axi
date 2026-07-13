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

Phase 0 scaffold. The dashboard, `setup hooks`, and the inherited `update` command work today.
Jira (`jira ...`, acli-backed) and Confluence (`confluence ...`, direct Cloud REST) command families land in later phases.

## Commands

```
commands[3]:
  (none)=dashboard, jira, confluence, setup
```

Run `npx -y atlassian-axi --help` for global flags, or `npx -y atlassian-axi <command> --help` for per-command usage.
Run `npx -y atlassian-axi setup hooks` to install SessionStart ambient context.

## Tips

- Output is TOON-encoded and token-efficient.
- Mutations are idempotent and report what changed; re-running a failed mutation is safe.
