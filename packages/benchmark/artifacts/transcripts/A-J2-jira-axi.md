<!-- provenance: measured accuracy run; executor final message verbatim (then redacted per src/redact.ts); task A-J2, surface jira-axi, executor model claude-fable-5, 2026-08-05 -->
# Transcript
## $ node <repo>/packages/jira-axi/dist/bin/jira-axi.js workitem view TEAM-43 --comments
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
count: 2 of 2 total
comments[2]{author,body}:
  Example User,E2E comment with a  code  span and  bold .
  Example User,envelope shape probe
help[4]:
  Run `jira-axi workitem comment TEAM-43 --body "..."` to comment
  Run `jira-axi workitem transition TEAM-43 --to <status>` to change status
  Run `jira-axi workitem assign TEAM-43 --assignee <email|@me>` to assign
  Run `jira-axi workitem edit TEAM-43 --summary "..."` to edit
```
# FINAL ANSWER
Work item TEAM-43 has 2 comments (count line: "2 of 2 total"), both authored by Example User:

1. "E2E comment with a code span and bold." (contains an inline code span and bold formatting; note the CLI's rendering flattens ADF marks lossily, so the plain-text output shows the words without their formatting)
2. "envelope shape probe"
