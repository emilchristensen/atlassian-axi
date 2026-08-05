<!-- provenance: measured accuracy run (plan-only); executor final message verbatim (then redacted per src/redact.ts); task A-J4, surface acli, executor model claude-fable-5, 2026-08-05 -->
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
## $ acli jira workitem transition --help
```
Transitioning a work item can mean moving it to another status, or performing a looped transition where the transition allows you to perform an action but keep the work item in its current status.

Usage:
  acli jira workitem transition [flags]

Examples:
# Transition work item with work item keys
$ acli jira workitem transition --key "KEY-1,KEY-2" --status "Done"

# Transition work item with JQL query
$ acli jira workitem transition --jql "project = TEAM" --status "In Progress"

# Transition work item with filter ID
$ acli jira workitem transition --filter 10001 --status "To Do" --yes

Flags:
      --filter string   Filter ID of work items to be transitioned
  -h, --help            Show help for command
      --ignore-errors   Ignore the errors and continue
      --jql string      JQL query for work items to be transitioned
      --json            Generate a JSON output
  -k, --key string      A list of work item keys to be transitioned
  -s, --status string   Status to transition the work item
  -y, --yes             Confirm transition without prompting
```
# PLANNED COMMAND
acli jira workitem transition --key "TEAM-40" --status "Done" --yes
# FINAL ANSWER
The command will transition Jira work item TEAM-40 to the status "Done" non-interactively (--yes skips the confirmation prompt).
