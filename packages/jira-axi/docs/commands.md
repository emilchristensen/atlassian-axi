# Commands

`jira-axi <resource> <subcommand> [flags]` wraps Atlassian `acli` to read and mutate Jira work items, projects, boards, sprints, filters, dashboards, and custom fields.

Use these commands for any Jira operation.
Flags MUST come after the subcommand.
Requires `acli` installed (`brew install acli`) and logged in (`acli jira auth login`); see [getting started](./getting-started.md).
All output is TOON.

Resources are addressed two ways:
- `workitem` and `project` are KEY-addressed (e.g. `TEAM-1`, `TEAM`).
- `board`, `sprint`, `filter`, `dashboard`, `field` are ID-addressed (numeric).

## workitem

Work items are key-addressed (e.g. `TEAM-42`).
Mutations (`create`, `edit`, `transition`, `assign`, `comment`) run non-interactively with acli `--yes`, then re-fetch and render the authoritative post-state.

Body inputs (`--body`/`--body-file` on `create`, `edit`, `comment`) accept a markdown SUBSET and are converted to real Jira ADF: headings, ordered + unordered + nested lists, inline code, fenced code blocks, bold, italic, links.
Raw ADF JSON is passed through unchanged.
It is NOT full CommonMark; unsupported markdown may render literally.

### `jira-axi workitem list`

List work items. Builds JQL internally and calls acli `workitem search` (acli has no `workitem list` subcommand).

**Flags:**
- `--jql <query>` verbatim JQL; exclusive with the filters below.
- `--project <KEY>`
- `--assignee <email|@me>`
- `--status <name>`
- `--limit <n>` (default 30)
- `--fields <a,b,c>`

```bash
jira-axi workitem list --project TEAM --status "In Progress"
```

**Caveats:**
- A bare `list` with no filters applies an `updated >= -30d ORDER BY updated DESC` window; acli rejects unbounded JQL.
- `--jql` combined with any of `--project`/`--assignee`/`--status` throws `VALIDATION_ERROR`.
- `--assignee @me` maps to `currentUser()`.

### `jira-axi workitem view <KEY>`

Show one work item.

**Flags:**
- `--comments` include comments.
- `--full` complete bodies without truncation.
- `--fields <a,b,c>` render only these fields; `key` is always included.

```bash
jira-axi workitem view TEAM-1 --comments
```

**Caveats:**
- The default render omits created/updated/priority unless requested; the CLI requests the full detail set by default.
- `--fields` with `--full` throws `VALIDATION_ERROR` (a `--fields` render is never truncated).
- Fields acli did not return are reported in a `note:` line, so a null row is not mistaken for an empty value.
- `--comments` is lossy: acli flattens comment ADF upstream (drops list items, strips marks). See [limitations](./limitations.md). The stored comment ADF is intact in the Jira UI.

### `jira-axi workitem create`

Create a work item, then re-fetch and render it.

**Flags:**
- `--project <KEY>` (required)
- `--type <name>` (required)
- `--summary <text>` (required)
- `--body <text>` or `--body-file <path>` markdown description, stored as ADF.
- `--assignee <email|@me>`
- `--label <a,b>`

```bash
jira-axi workitem create --project TEAM --type Task --summary "Fix login"
```

**Caveats:**
- Missing any required flag throws `VALIDATION_ERROR`.
- If acli output has no detectable key, the CLI still reports success with a `message` field.

### `jira-axi workitem edit <KEY>`

Edit a work item, then re-fetch and render it.

**Flags:**
- `--summary <text>`
- `--body <text>` or `--body-file <path>` markdown description, stored as ADF.
- `--assignee <email|@me>`
- `--type <name>`
- `--labels <a,b>`
- `--remove-labels <a,b>`

```bash
jira-axi workitem edit TEAM-1 --summary "New title" --labels backend,urgent
```

**Caveats:**
- At least one changing flag is required; none throws `VALIDATION_ERROR`.

### `jira-axi workitem transition <KEY> --to <status>`

Move a work item to a status.

**Flags:**
- `--to <status>` (required)

```bash
jira-axi workitem transition TEAM-1 --to Done
```

**Caveats:**
- Idempotent: `--to` naming the current status is a no-op success (renders `message: "Already <status>"`), safe to retry.

### `jira-axi workitem assign <KEY> --assignee <user>`

Assign a work item.

**Flags:**
- `--assignee <email|@me>` (required)

```bash
jira-axi workitem assign TEAM-1 --assignee jane@acme.com
```

**Caveats:**
- Idempotent for a concrete user: if already assigned to that user, it is a no-op success. `@me` and `default` always resolve server-side and go through acli.

### `jira-axi workitem comment <KEY> --body <text>`

Add a comment, then re-fetch and render the item.

**Flags:**
- `--body <text>` or `--body-file <path>` (required) markdown, stored as ADF.

```bash
jira-axi workitem comment TEAM-1 --body "Deployed to staging"
```

### `jira-axi workitem search "<JQL>"`

Run a verbatim JQL query.

**Flags:**
- `--limit <n>` (default 30)
- `--fields <a,b,c>`

```bash
jira-axi workitem search "assignee = currentUser() AND resolution = EMPTY"
```

**Caveats:**
- The JQL positional is required; missing it throws `VALIDATION_ERROR`.

## project

Projects are key-addressed (e.g. `TEAM`).

### `jira-axi project list`

List projects.

**Flags:**
- `--limit <n>` (default 30)

```bash
jira-axi project list
```

### `jira-axi project view <KEY>`

Show one project.

```bash
jira-axi project view TEAM
```

## board

Boards are ID-addressed (numeric).

### `jira-axi board list`

List boards. Maps onto acli `board search` (acli has no `board list`).

**Flags:**
- `--name <substring>`
- `--project <KEY>`
- `--type <scrum|kanban|simple>`
- `--limit <n>` (default 30)

```bash
jira-axi board list --project TEAM
```

### `jira-axi board view <ID>`

Show one board.

```bash
jira-axi board view 1013
```

### `jira-axi board list-sprints <ID>`

List sprints on a board.

**Flags:**
- `--state <future,active,closed>` comma-separated.
- `--limit <n>` (default 30)

```bash
jira-axi board list-sprints 1013 --state active
```

### `jira-axi board list-projects <ID>`

List projects associated with a board.

**Flags:**
- `--limit <n>` (default 30)

```bash
jira-axi board list-projects 1013
```

## sprint

Sprints are ID-addressed (numeric).
Dates render as `YYYY-MM-DD`, not relative times.

### `jira-axi sprint view <ID>`

Show one sprint.

```bash
jira-axi sprint view 5205
```

### `jira-axi sprint list-workitems <ID> --board <ID>`

List work items in a sprint.

**Flags:**
- `--board <ID>` (required by the Jira agile API)
- `--jql <query>`
- `--fields <a,b,c>`
- `--limit <n>` (default 30)

```bash
jira-axi sprint list-workitems 5205 --board 1013
```

**Caveats:**
- Both the sprint ID positional AND `--board` are required; the agile API needs both.

### `jira-axi sprint create --board <ID> --name <text>`

Create a sprint.

**Flags:**
- `--board <ID>` (required)
- `--name <text>` (required)
- `--start <ISO date>`
- `--end <ISO date>`
- `--goal <text>`

```bash
jira-axi sprint create --board 1013 --name "Sprint 13" --goal "Ship checkout"
```

### `jira-axi sprint update <ID>`

Update a sprint.

**Flags:**
- `--name <text>`
- `--goal <text>`
- `--state <future|active|closed>`
- `--start <ISO date>`
- `--end <ISO date>`

```bash
jira-axi sprint update 5205 --state closed
```

**Caveats:**
- Idempotent on state: `--state` naming the current state is a no-op success, safe to retry.

## filter

Filters are ID-addressed (numeric).

### `jira-axi filter list`

List filters. Defaults to filters you own.

**Flags:**
- `--favourite` list your favourite filters instead of owned ones.
- `--limit <n>` (default 30, applied client-side)

```bash
jira-axi filter list
```

**Caveats:**
- The upstream API requires exactly one of my/favourite; the CLI defaults to owned (`--my`) and `--favourite` switches to favourites.

### `jira-axi filter search`

Search filters.

**Flags:**
- `--name <substring>`
- `--owner <email>`
- `--limit <n>` (default 30)

```bash
jira-axi filter search --name backlog
```

### `jira-axi filter view <ID>`

Show one filter.

```bash
jira-axi filter view 33312
```

### `jira-axi filter update <ID>`

Update a filter.

**Flags:**
- `--name <text>`
- `--description <text>`
- `--jql <query>`

```bash
jira-axi filter update 33312 --jql "project = TEAM AND status = Open"
```

**Caveats:**
- Idempotent: an update that changes nothing is a no-op success, safe to retry.

## dashboard

Dashboards are ID-addressed. Only `list` is available (maps onto acli `dashboard search`; acli has no `dashboard list`).

### `jira-axi dashboard list`

List dashboards.

**Flags:**
- `--name <substring>`
- `--owner <email>`
- `--limit <n>` (default 30)

```bash
jira-axi dashboard list --name release --owner jane@acme.com
```

## field

Custom fields are ID-addressed (`customfield_<n>`). acli has NO field `list`/`view` - only the mutations below.

To inspect field VALUES on a work item, use `jira-axi workitem view <KEY> --fields <a,b,c>` instead.
A bare numeric ID `<n>` is accepted and expanded to `customfield_<n>` (the expanded ID is echoed in the output).

### `jira-axi field create --name <text> --type <key>`

Create a custom field.

**Flags:**
- `--name <text>` (required)
- `--type <key>` (required) full type key, e.g. `com.atlassian.jira.plugin.system.customfieldtypes:textfield`.
- `--description <text>`
- `--searcher-key <key>`

```bash
jira-axi field create --name "Customer Name" --type "com.atlassian.jira.plugin.system.customfieldtypes:textfield"
```

### `jira-axi field update <ID>`

Update a custom field.

**Flags:**
- `--name <text>`
- `--description <text>`
- `--searcher-key <key>`

```bash
jira-axi field update customfield_12345 --name "Client Name"
```

### `jira-axi field delete <ID>`

Move a custom field to trash.

```bash
jira-axi field delete customfield_12345
```

**Caveats:**
- Delete moves the field to trash; it is restorable with `restore`.
- acli has no `--json` for delete/restore, so the CLI renders its own confirmation.

### `jira-axi field restore <ID>`

Restore a trashed custom field.

```bash
jira-axi field restore customfield_12345
```

## See also

- [Getting started](./getting-started.md) - the `acli` prerequisite and login.
- [Limitations](./limitations.md) - known lossy behaviors (e.g. comment ADF flattening).
- [Setup & update](./setup.md) - `setup hooks`, `update`.
