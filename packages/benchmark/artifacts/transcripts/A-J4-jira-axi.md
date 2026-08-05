<!-- provenance: measured accuracy run (plan-only); executor final message verbatim (then redacted per src/redact.ts); task A-J4, surface jira-axi, executor model claude-fable-5, 2026-08-05 -->
# Transcript
## $ node <repo>/packages/jira-axi/dist/bin/jira-axi.js workitem transition --help
```
usage: jira-axi workitem <subcommand> [flags]
subcommands[8]:
  list, view <KEY>, create, edit <KEY>, transition <KEY>, assign <KEY>, comment <KEY>, search "<JQL>"
flags{list}:
  --jql <query> (verbatim; exclusive with the filters below), --project <KEY>, --assignee <email|@me>, --status <name>, --limit <n> (default 30), --fields <a,b,c> (no filters => updated >= -30d window; acli rejects unbounded JQL)
flags{view}:
  --comments, --limit <n> (comments shown, default 30; requires --comments), --full (complete bodies without truncation), --fields <a,b,c> (render only these fields; key is always included)
flags{create}:
  --project <KEY> (required), --type <name> (required), --summary <text> (required), --body <text> or --body-file <path> (markdown description, stored as ADF), --assignee <email|@me>, --label <a,b>
flags{edit}:
  --summary <text>, --body <text> or --body-file <path> (markdown description, stored as ADF), --assignee <email|@me>, --type <name>, --labels <a,b>, --remove-labels <a,b>
flags{transition}:
  --to <status> (required; no-op success when already there)
flags{assign}:
  --assignee <email|@me> (required)
flags{comment}:
  --body <text> or --body-file <path> (required; markdown, stored as ADF)
flags{search}:
  --limit <n> (default 30), --fields <a,b,c>
examples:
  jira-axi workitem list --project TEAM --status "In Progress"
  jira-axi workitem view TEAM-1 --comments
  jira-axi workitem create --project TEAM --type Task --summary "Fix login"
  jira-axi workitem transition TEAM-1 --to Done
  jira-axi workitem search "assignee = currentUser() AND resolution = EMPTY"
```
# PLANNED COMMAND
node <repo>/packages/jira-axi/dist/bin/jira-axi.js workitem transition TEAM-40 --to Done
# FINAL ANSWER
The command will transition work item TEAM-40 to the status "Done" (a no-op success if it is already there).
