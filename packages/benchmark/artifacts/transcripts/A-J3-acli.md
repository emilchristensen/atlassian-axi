<!-- provenance: measured accuracy run; executor final message verbatim (then redacted per src/redact.ts); task A-J3, surface acli, executor model claude-fable-5, 2026-08-05 -->
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
## $ acli jira workitem search --help
```
Searches for work item or multiple work items.

Usage:
  acli jira workitem search [flags]

Examples:
# Search for work items with JQL query
$ acli jira workitem search --jql "project = TEAM" --paginate
$ acli jira workitem search --jql "project = TEAM" --count
$ acli jira workitem search --jql "project = TEAM" --fields "key,summary,assignee" --csv
$ acli jira workitem search --jql "project = TEAM" --limit 50 --json
# Search for work items with filter ID
$ acli jira workitem search --filter 10001 --web


Flags:
      --count           Number of work items in the search
      --csv             Generate a CSV output
  -f, --fields string   Comma-separated list of fields to display in the output (default "issuetype,key,assignee,priority,status,summary")
      --filter string   Filter ID of work items to be searched
  -h, --help            Show help for command
  -j, --jql string      JQL query to search for work items
      --json            Generate a JSON output
  -l, --limit int       Maximum number of work items to fetch
      --paginate        Fetch all work items by paginating through the results
  -w, --web             Search for work items in the web browser
```
## $ acli jira workitem search --jql "project = TEAM AND summary ~ 'scratch'" --fields "key,summary" --paginate
```
┌─────────┬───────────────────────────┐
│ Key     │ Summary                   │
├─────────┼───────────────────────────┤
│ TEAM-43 │ [scratch] jira-axi E2E ed │
│         │ ited (delete me)          │
├─────────┼───────────────────────────┤
│ TEAM-42 │ [scratch] axi finalize E2 │
│         │ E edited (delete me)      │
├─────────┼───────────────────────────┤
│ TEAM-41 │ [scratch] ADF after-fix d │
│         │ emo (delete me)           │
├─────────┼───────────────────────────┤
│ TEAM-40 │ [scratch] ADF before-fix  │
│         │ demo (delete me)          │
└─────────┴───────────────────────────┘
```
## $ acli jira workitem search --jql "project = TEAM AND summary ~ 'scratch'" --fields "key,summary" --paginate --json
```
[
  {
    "changelog": null,
    "editmeta": null,
    "expand": "renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations",
    "fields": {
      "summary": "[scratch] jira-axi E2E edited (delete me)"
    },
    "fieldsToInclude": null,
    "id": "448703",
    "key": "TEAM-43",
    "names": null,
    "operations": null,
    "properties": null,
    "renderedFields": null,
    "schema": null,
    "self": "https://jira-prod-eu-112-2.prod.atl-paas.net/rest/api/3/issue/448703",
    "transitions": null,
    "versionedRepresentations": null
  },
  {
    "changelog": null,
    "editmeta": null,
    "expand": "renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations",
    "fields": {
      "summary": "[scratch] axi finalize E2E edited (delete me)"
    },
    "fieldsToInclude": null,
    "id": "448490",
    "key": "TEAM-42",
    "names": null,
    "operations": null,
    "properties": null,
    "renderedFields": null,
    "schema": null,
    "self": "https://jira-prod-eu-112-2.prod.atl-paas.net/rest/api/3/issue/448490",
    "transitions": null,
    "versionedRepresentations": null
  },
  {
    "changelog": null,
    "editmeta": null,
    "expand": "renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations",
    "fields": {
      "summary": "[scratch] ADF after-fix demo (delete me)"
    },
    "fieldsToInclude": null,
    "id": "448352",
    "key": "TEAM-41",
    "names": null,
    "operations": null,
    "properties": null,
    "renderedFields": null,
    "schema": null,
    "self": "https://jira-prod-eu-112-2.prod.atl-paas.net/rest/api/3/issue/448352",
    "transitions": null,
    "versionedRepresentations": null
  },
  {
    "changelog": null,
    "editmeta": null,
    "expand": "renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations",
    "fields": {
      "summary": "[scratch] ADF before-fix demo (delete me)"
    },
    "fieldsToInclude": null,
    "id": "448351",
    "key": "TEAM-40",
    "names": null,
    "operations": null,
    "properties": null,
    "renderedFields": null,
    "schema": null,
    "self": "https://jira-prod-eu-112-2.prod.atl-paas.net/rest/api/3/issue/448351",
    "transitions": null,
    "versionedRepresentations": null
  }
]
```
# FINAL ANSWER
JQL used: `project = TEAM AND summary ~ 'scratch'`

4 work items in project TEAM have a summary containing 'scratch':
- TEAM-40 - "[scratch] ADF before-fix demo (delete me)"
- TEAM-41 - "[scratch] ADF after-fix demo (delete me)"
- TEAM-42 - "[scratch] axi finalize E2E edited (delete me)"
- TEAM-43 - "[scratch] jira-axi E2E edited (delete me)"

Keys: TEAM-40, TEAM-41, TEAM-42, TEAM-43
