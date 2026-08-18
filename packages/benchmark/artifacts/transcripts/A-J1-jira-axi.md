<!-- provenance: measured accuracy run; executor final message verbatim (then redacted per src/redact.ts); task A-J1, surface jira-axi, executor model claude-fable-5, 2026-08-05 -->
# Transcript
## $ node <repo>/packages/jira-axi/dist/bin/jira-axi.js workitem view TEAM-43
```
workitem:
  key: TEAM-43
  summary: "[scratch] jira-axi E2E edited (delete me)"
  type: Task
  status: done
  assignee: Example User
  priority: Normal
  created: 15d ago
  updated: 15d ago
  body: "E2E test\nBody with bold, italic, inline code, and a link.\nitem one\nitem two\nnested\ncode block"
help[4]:
  Run `jira-axi workitem comment TEAM-43 --body "..."` to comment
  Run `jira-axi workitem transition TEAM-43 --to <status>` to change status
  Run `jira-axi workitem assign TEAM-43 --assignee <email|@me>` to assign
  Run `jira-axi workitem edit TEAM-43 --summary "..."` to edit
```
# FINAL ANSWER
TEAM-43:
- Summary: [scratch] jira-axi E2E edited (delete me)
- Status: done
- Assignee: Example User
