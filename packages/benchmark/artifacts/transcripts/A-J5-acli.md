<!-- provenance: measured accuracy run (plan-only); executor final message verbatim (then redacted per src/redact.ts); task A-J5, surface acli, executor model claude-fable-5, 2026-08-05 -->
# Transcript
## $ acli jira --help
```
Jira Cloud commands.

Usage:
  acli jira [command]

Available Commands:
  auth        Authenticate to use Jira with OAuth or API token.
  board       Jira board commands.
  dashboard   Jira dashboard commands.
  field       Jira field commands.
  filter      Jira filter commands.
  project     Jira project commands.
  sprint      Jira sprint commands.
  workitem    Jira work item commands.

Flags:
  -h, --help   Show help for command

Use "acli jira [command] --help" for more information about a command.
```
## $ acli jira workitem comment --help
```
Work item comments commands.

Usage:
  acli jira workitem comment [command]

Available Commands:
  create      Create a comment on work items
  delete      Delete a comment for a given workitem
  list        List comments for a work item.
  update      Update a comment on a work item.
  visibility  Get visibility options for work item comments.

Flags:
  -h, --help   Show help for command

Use "acli jira workitem comment [command] --help" for more information about a command.
```
## $ acli jira workitem comment create --help
```
Add a comment to a work item or multiple work items using the default visibility for the project.

Usage:
  acli jira workitem comment create [flags]

Examples:
# Comment on work item with work item keys
$ acli jira workitem comment --key "KEY-1" --body "This is a comment"

# Comment on work item with JQL query and plain text file 
$ acli jira workitem comment --jql "project = TEAM" --body-file "comment.txt" --edit-last

# Comment on work item with JQL query
$ acli jira workitem comment --jql "project = TEAM" --editor

Flags:
  -b, --body string        Comment body in plain text or Atlassian Document Format (ADF)
  -F, --body-file string   Plain text file with text or Atlassian Document Format (ADF)
  -e, --edit-last          Edit the last comment from the same author
      --editor             Skip prompts and open the text editor to write the body
      --filter string      Filter ID of work items to comment
  -h, --help               Show help for command
      --ignore-errors      Ignore the errors and continue
      --jql string         JQL query for work items to comment
      --json               Generate a JSON output
  -k, --key string         A list of work item keys to comment
```
# PLANNED COMMAND
acli jira workitem comment create --key "TEAM-40" --body "benchmark probe"
# FINAL ANSWER
The command will add a plain-text comment "benchmark probe" to Jira work item TEAM-40 using the project's default comment visibility.
