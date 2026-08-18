<!-- provenance: measured accuracy run; executor final message verbatim (then redacted per src/redact.ts); task A-J1, surface acli, executor model claude-fable-5, 2026-08-05 -->
# Transcript
## $ acli --help
```
Work seamlessly with Atlassian from the command line.

Usage:
  acli [command]

Available Commands
  admin       Admin commands.
  auth        Authenticate to multiple Atlassian accounts with OAuth.
  confluence  Confluence Cloud commands.
  guard       Atlassian Guard CLI.
  jira        Jira Cloud commands.
  rovodev     Atlassian’s AI coding agent: Rovo Dev (Beta).

Additional Commands:
  completion  Generate the autocompletion script for the specified shell
  config      Commands for changing configuration settings.
  feedback    Submit a request or report a problem.
  help        Help about any command

Flags:
  -h, --help      Show help for command
  -v, --version   version for acli

Use "acli [command] --help" for more information about a command.
```
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
## $ acli jira workitem --help
```
Jira work item commands.

Usage:
  acli jira workitem [command]

Available Commands:
  archive       Archives a work item or multiple work items.
  assign        Assign a work item(s) to an assignee(s).
  attachment    Work item attachments commands.
  clone         Create a duplicate work item(s).
  comment       Work item comments commands.
  create        Create a Jira work item.
  create-bulk   Bulk create Jira issues.
  delete        Delete a work item or multiple work items.
  edit          Edit a Jira work item or multiple work items.
  link          Link work items commands.
  list-watchers List watchers of an issue
  search        Searches for work item or multiple work items.
  transition    Transitioning a work item.
  unarchive     Unarchives work item or multiple work items.
  view          Retrieve information about Jira work items.
  watcher       Work item watcher commands.

Flags:
  -h, --help   Show help for command

Use "acli jira workitem [command] --help" for more information about a command.
```
## $ acli jira workitem view --help
```
Retrieve information about Jira work items.

Usage:
  acli jira workitem view [key] [flags]

Examples:
# View work item with work item keys
$ acli jira workitem view KEY-123

# View work item by reading work item keys from a JSON file
$ acli jira workitem view KEY-123 --json

# View work item with work item keys and a list of field to return
$ acli jira workitem view KEY-123 --fields summary,comment

# View work item with work item keys and view in a web browser
$ acli jira workitem view KEY-123 --web

Flags:
  -f, --fields string   A list of fields to return for the work item. This parameter accepts a comma-separated list. Use it to retrieve a subset of fields.
                        Allowed values:
                        - '*all' - returns all fields
                        - '*navigable' - returns navigable fields
                        Any work item field, prefixed with a minus to exclude
                        Examples:
                        - 'summary,comment' - returns only the summary and comments fields
                        - '-description' - returns all (default) fields except description
                        - '*navigable,-comment' - returns all navigable fields except comment
                         (default "key,issuetype,summary,status,assignee,description")
  -h, --help            Show help for command
      --json            Generate a JSON output
  -w, --web             View the work item in the web browser.
```
## $ acli jira workitem view TEAM-43
```
Key: TEAM-43
Type: Task
Summary: [scratch] jira-axi E2E edited (delete me)
Status: Done
Assignee: user@example.com
Description: E2E test
Body with bold, italic, inline code, and a link.
item one
item two
nestedcode block
```
# FINAL ANSWER
Work item TEAM-43:
- Summary: [scratch] jira-axi E2E edited (delete me)
- Status: Done
- Assignee: user@example.com
