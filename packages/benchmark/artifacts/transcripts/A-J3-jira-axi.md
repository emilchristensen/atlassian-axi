<!-- provenance: measured accuracy run; executor final message verbatim (then redacted per src/redact.ts); task A-J3, surface jira-axi, executor model claude-fable-5, 2026-08-05 -->
# Transcript
## $ node <repo>/packages/jira-axi/dist/bin/jira-axi.js workitem search "project = TEAM AND summary ~ 'scratch'"
```
count: 4
workitems[4]{key,summary,status,assignee}:
  TEAM-43,"[scratch] jira-axi E2E edited (delete me)",done,Example User
  TEAM-42,"[scratch] axi finalize E2E edited (delete me)",done,Example User
  TEAM-41,"[scratch] ADF after-fix demo (delete me)",done,unassigned
  TEAM-40,"[scratch] ADF before-fix demo (delete me)",todo,unassigned
help[2]:
  Run `jira-axi workitem view <KEY>` to view details
  Run `jira-axi workitem transition <KEY> --to <status>` to move one
```
# FINAL ANSWER
4 work items in project TEAM have 'scratch' in their summary:
- TEAM-43
- TEAM-42
- TEAM-41
- TEAM-40
