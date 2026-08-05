# Pre-declared expectations and rating scale

Declared and committed before any accuracy run was executed.
The scoring pass (`artifacts/scoring.md`) rates each committed transcript against this file and nothing else.

## Rating scale

- `correct` - the agent picked the expected operation, produced a result matching the expected properties, and used no wrong or hallucinated parameters, on the first attempt.
- `correct-with-retries` - the final result matches the expectation, but one or more earlier attempts failed or used wrong parameters and were corrected.
- `wrong` - the agent reported success but the operation or result does not match the expectation, or it invented parameters/operations that do not exist and treated them as working.
- `unable` - the agent could not complete the task and said so.
  When the expectation for that surface is "correctly report that the surface cannot do this", a clear unsupported-report is scored `correct`, not `unable`.
- `not-rated` - the surface could not be driven at all in this environment.
  Every MCP cell is `not-rated`: the Atlassian Rovo MCP server requires interactive OAuth that cannot be completed here (verified: unauthenticated `tools/list` returns HTTP 401).

Write tasks are plan-only: the agent must state the exact command it would run without executing it, and is scored on operation choice and parameter correctness against the expected command.
This is labeled derived-from-docs in the results because the effect on the live site is never verified.

## Executor protocol

Each accuracy run is a fresh agent given only:

1. The surface context: for jira-axi/confluence-axi, the package's `SKILL.md` verbatim plus the path to the built binary; for acli, the statement "the `acli` CLI (Atlassian's official CLI) is installed and authenticated; discover usage via `--help`".
2. The task statement below, verbatim.
3. Rules: live site, strictly read-only; write tasks are plan-only (state the command, do not run it); log every command you run and its outcome; finish with `FINAL ANSWER:` followed by the requested facts.

The executor never sees this file's expectations.
The scorer never executes commands; it reads only the transcript and this file.

## Task statements and expectations

### A-J1 view a work item

Task statement: "Show me work item TEAM-43: its summary, status, and assignee."

| Surface | Expected operation | Expected result properties |
|---|---|---|
| jira-axi | `workitem view TEAM-43` | summary contains "[scratch] jira-axi E2E edited"; status done; assignee is the site user |
| acli | `acli jira workitem view TEAM-43` | same properties |
| MCP | not-rated | not-rated |

### A-J2 read comments

Task statement: "What comments are on work item TEAM-43, and how many are there?"

| Surface | Expected operation | Expected result properties |
|---|---|---|
| jira-axi | `workitem view TEAM-43 --comments` | reports exactly 2 comments; one mentions an E2E comment with code span and bold, one says "envelope shape probe" |
| acli | `acli jira workitem comment list TEAM-43` (any output mode) | same 2 comments |
| MCP | not-rated | not-rated |

### A-J3 JQL search

Task statement: "Using JQL, find all work items in project TEAM whose summary contains 'scratch'. List their keys."

| Surface | Expected operation | Expected result properties |
|---|---|---|
| jira-axi | `workitem search "<JQL>"` with JQL equivalent to `project = TEAM AND summary ~ "scratch"` | keys TEAM-40, TEAM-41, TEAM-42, TEAM-43; no others |
| acli | `acli jira workitem search --jql "<same JQL>"` | same keys |
| MCP | not-rated | not-rated |

### A-J4 transition (plan-only)

Task statement: "Work item TEAM-40 needs to move to status 'Done'. State the exact command you would run. Do not run it."

| Surface | Expected command | Notes |
|---|---|---|
| jira-axi | `jira-axi workitem transition TEAM-40 --to Done` (bin path or npx form accepted) | flag is `--to`; no `--yes` needed (the CLI supplies acli's gate itself) |
| acli | `acli jira workitem transition --key TEAM-40 --status Done --yes` (`--yes` may be omitted; then acli prompts) | key goes in `--key`, status in `--status` |
| MCP | not-rated | not-rated |

### A-J5 add a comment (plan-only)

Task statement: "Add the comment 'benchmark probe' to work item TEAM-40. State the exact command you would run. Do not run it."

| Surface | Expected command | Notes |
|---|---|---|
| jira-axi | `jira-axi workitem comment TEAM-40 --body "benchmark probe"` | comment is a workitem subcommand, not `comment create` |
| acli | `acli jira workitem comment create --key TEAM-40 --body "benchmark probe"` (`--yes` optional) | acli requires the `create` subcommand and `--key` |
| MCP | not-rated | not-rated |

### A-C1 read a page

Task statement: "Read Confluence page 18753552796 and tell me its title and roughly what its body says."

| Surface | Expected operation | Expected result properties |
|---|---|---|
| confluence-axi | `page get 18753552796` | title "draw.io Configuration Home"; body is the Confluence welcome/space-home boilerplate |
| acli | `acli confluence page view --id 18753552796` | same title; body available (any body format) |
| MCP | not-rated | not-rated |

### A-C2 CQL search

Task statement: "Using CQL, find all pages in the DRAWIOCONFIG space. List their titles."

| Surface | Expected operation | Expected result properties |
|---|---|---|
| confluence-axi | `search "space = DRAWIOCONFIG and type = page"` (equivalent CQL accepted) | 5 pages: Logs, Libraries, Templates, Configuration, draw.io Configuration Home |
| acli | correctly reports acli has no Confluence search command (checking `--help` counts as evidence) | an unsupported-report is `correct`; any invented search command is `wrong` |
| MCP | not-rated | not-rated |

### A-C3 list children

Task statement: "List the direct child pages of Confluence page 18753552796."

| Surface | Expected operation | Expected result properties |
|---|---|---|
| confluence-axi | `page children 18753552796` | children include Logs, Libraries, Templates, Configuration |
| acli | `acli confluence page view --id 18753552796 --include-direct-children` | same children named |
| MCP | not-rated | not-rated |

### A-C4 list labels

Task statement: "What labels does Confluence page 18753814575 have?"

| Surface | Expected operation | Expected result properties |
|---|---|---|
| confluence-axi | `page labels 18753814575` | reports the actual label set; an explicit "no labels"/empty-set answer matches if the live set is empty |
| acli | `acli confluence page view --id 18753814575 --include-labels` | same label set |
| MCP | correctly not attempted | no documented label tool exists; not-rated regardless |

### A-C5 list attachments

Task statement: "List the attachments on Confluence page 18753814575, with their filenames."

| Surface | Expected operation | Expected result properties |
|---|---|---|
| confluence-axi | `page attachments 18753814575` | includes configuration.json |
| acli | correctly reports acli cannot list attachments (no such command/flag) | an unsupported-report is `correct` |
| MCP | not-rated | not-rated |

### A-C6 create a page (plan-only)

Task statement: "Create a Confluence page titled 'Benchmark probe' in space DRAWIOCONFIG with body '<p>probe</p>'. State the exact command you would run. Do not run it."

| Surface | Expected command | Notes |
|---|---|---|
| confluence-axi | `confluence-axi page create --space DRAWIOCONFIG --title "Benchmark probe" --body "<p>probe</p>"` | storage-format body; `--body-file` variant accepted |
| acli | correctly reports acli cannot create a page (page tree is view-only) | an unsupported-report is `correct`; suggesting `space create` or `blog create` as a page create is `wrong` |
| MCP | not-rated | not-rated |

### A-C7 update a page (plan-only)

Task statement: "Change the title of Confluence page 18753814575 to 'Configuration (renamed)'. State the exact command you would run. Do not run it."

| Surface | Expected command | Notes |
|---|---|---|
| confluence-axi | `confluence-axi page update 18753814575 --title "Configuration (renamed)"` | title-only edit keeps the body; no `--body` required |
| acli | correctly reports acli cannot update a page | an unsupported-report is `correct` |
| MCP | not-rated | not-rated |
