| Operation | jira-axi | MCP | acli |
|---|---|---|---|
| View a work item | supported [m] - workitem view <KEY> | supported [d] - getJiraIssue | supported [m] - workitem view <KEY> |
| JQL search | supported [m] - workitem search "<JQL>" | supported [d] - searchJiraIssuesUsingJql | supported [m] - workitem search --jql "<JQL>" |
| Filtered list without hand-writing JQL | supported [m] - workitem list --project/--assignee/--status (builds the JQL) | unsupported [d] - only raw JQL via searchJiraIssuesUsingJql | unsupported [m] - workitem search requires --jql; there is no workitem list |
| Create a work item | supported [m] - workitem create | supported [d] - createJiraIssue (+ getJiraIssueTypeMetaWithFields for required fields) | supported [m] - workitem create |
| Edit work item fields | supported [m] - workitem edit <KEY> | supported [d] - editJiraIssue | supported [m] - workitem edit |
| Transition a work item | supported [m] - workitem transition <KEY> --to <status> | supported [d] - getTransitionsForJiraIssue + transitionJiraIssue (two calls: the transition id must be looked up first) | supported [m] - workitem transition --key <KEY> --status <status> |
| Assign a work item | supported [m] - workitem assign <KEY> --assignee <email|@me> | partial [d] - editJiraIssue with an accountId from lookupJiraAccountId (no dedicated assign tool) | supported [m] - workitem assign |
| Read comments | supported [m] - workitem view <KEY> --comments | partial [d] - no dedicated comment-list tool documented; comments come back inside getJiraIssue fields | supported [m] - workitem comment list <KEY> |
| Add a comment | supported [m] - workitem comment <KEY> --body <text> | supported [d] - addCommentToJiraIssue | supported [m] - workitem comment create --key <KEY> --body <text> |
| Markdown body stored as rich text (ADF) | supported [m] - create/edit/comment --body accepts markdown and converts to ADF | not-established [d] - the docs do not state the accepted body format | partial [m] - --body takes plain text or raw ADF JSON; no markdown conversion |
| List/view projects | supported [m] - project list / project view <KEY> | supported [d] - getVisibleJiraProjects | supported [m] - project list / project view |
| Project admin (create/update/delete/archive/restore) | unsupported [m] - project is list/view only | unsupported [d] - no project-admin tools documented | supported [m] - project create/update/delete/archive/restore |
| Boards (list, view, sprints of a board) | supported [m] - board list/view/list-sprints/list-projects | unsupported [d] - no board tools documented | supported [m] - board search/view/list-sprints/list-projects (no board list; search is the list path) |
| Sprints (view, create, update/close, list work items) | supported [m] - sprint view/create/update/list-workitems | unsupported [d] - no sprint tools documented | supported [m] - sprint subcommands |
| Saved filters (list/search/view/update) | supported [m] - filter list/search/view/update | unsupported [d] - no filter tools documented | supported [m] - filter subcommands |
| Dashboards (list) | supported [m] - dashboard list | unsupported [d] - no dashboard tools documented | supported [m] - dashboard search (no dashboard list) |
| Custom fields (create/update/delete/restore) | supported [m] - field create/update/delete/restore | unsupported [d] - no field tools documented | supported [m] - field subcommands |
| Worklogs (log time on an item) | unsupported [m] - no worklog command | supported [d] - addWorklogToJiraIssue | unsupported [m] - no worklog subcommand under workitem |
| Remote issue links (e.g. linked Confluence pages) | unsupported [m] - no remote-link command | supported [d] - getJiraIssueRemoteIssueLinks | unsupported [m] - workitem link covers item-to-item links only |
| Link two work items | unsupported [m] - no link command | not-established [d] - getIssueLinkTypes is documented read-only; no create-link tool is listed, though createJiraIssue's published description mentions linking (a likely docs error) | supported [m] - workitem link create/delete/list/type |
| Work item attachments | unsupported [m] - no attachment command | unsupported [d] - no attachment tools documented | supported [m] - workitem attachment subcommands |
| Bulk operations (bulk create, JQL-wide transition/comment) | unsupported [m] - single-item mutations only | unsupported [d] - single-item tools only | supported [m] - create-bulk; transition/comment accept --jql and --filter |
| Archive/unarchive/clone/delete work items, watchers | unsupported [m] - not exposed | unsupported [d] - not documented | supported [m] - workitem archive/unarchive/clone/delete/list-watchers/watcher |
| Resolve a user to an accountId | unsupported [m] - no user lookup (assign takes an email or @me directly) | supported [d] - lookupJiraAccountId | unsupported [m] - no user command group |

Provenance markers: `[m]` = measured, `[d]` = derived-from-docs.
- measured: verified live against the installed CLI (jira-axi 1.0.3 from this repo, acli 1.3.22-stable) via its help output or a live read-only invocation on 2026-08-05
- derived-from-docs: taken from the Atlassian Rovo MCP Server supported-tools documentation (fetched 2026-08-05); the server could not be driven here
