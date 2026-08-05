# Getting started

`jira-axi` is an agent-ergonomic CLI wrapping Atlassian `acli` for Jira.

Use this doc to install, authenticate `acli`, and run your first commands.
For exhaustive flags see [commands](./commands.md) and [limitations](./limitations.md).

## Quick Start

Install the jira-axi skill in the Agent Skills format with npx skills:

```bash
npx -y skills@latest add emilchristensen/atlassian-axi --skill jira-axi -g
```

That is the entire setup - no npm install needed.
The skill teaches your agent to run jira-axi through `npx -y jira-axi@latest`, so the CLI comes along on demand.
You still need `acli` installed (`brew install acli`) and authenticated via `acli jira auth login` (Node >= 20 required).

The skill is not a user-facing slash command (`user-invocable: false`).
Its frontmatter also includes Hermes Agent metadata (`metadata.hermes`) so Hermes can categorize it as a productivity skill tagged for Atlassian, Jira, and acli.
Just ask for anything that touches Jira - viewing or editing a work item, moving a ticket through its workflow, assigning it, reading or adding comments, searching with JQL, or working with boards, sprints, and filters - and the agent loads the skill on its own when it recognizes the task.

`-g` installs the skill user-level for all projects; drop it to install for the current project only (`./.agents/skills/`, symlinked into each agent's own skill directory).

## Other Ways to Install

The skill is the recommended path, but it is not the only one.

### Zero setup

jira-axi is an AXI, so any capable agent can run the CLI directly with nothing installed at all.
Just tell your agent:

```
Execute `npx -y jira-axi@latest` to get Jira tools.
```

The `@latest` pin ensures you always run the newest published version.

### Session hook

Want ambient Jira context - your open work items and whether `acli` is ready - fed into every agent session instead of loading on demand?
Install the CLI globally and opt into the hook:

```bash
npm install -g jira-axi
jira-axi setup hooks
```

This installs a SessionStart hook for Claude Code, Codex, and OpenCode that invokes the installed bin with no args at the start of each session, adding:

- `acli: installed` - whether the required `acli` prerequisite is actually present, before you run a command that needs it.
- `my_open_workitems[N]{key,summary,status}` - your own open Jira work items, each with key, summary and status.
- `help[N]` - a contextual line naming the available commands.

Restart your agent session after running this so the new hook takes effect.
For global installs, run `jira-axi update --check` to see whether a newer release is available, or `jira-axi update` to upgrade.

Every command below works identically under `npx`.

## Prerequisites

- Node >= 20.
- `acli` (the Atlassian CLI) - required. `jira-axi` shells out to it for every Jira operation.
  Install it with `brew install acli`.

`jira-axi` has NO auth or config of its own.
It rides `acli`'s credential, so authentication is delegated entirely to `acli`'s native login.
If `acli` is not installed or not logged in, every `jira-axi` command errors with a next-step suggestion.

## Authenticate acli

Log `acli` into your Jira site once:

```bash
acli jira auth login
```

Follow acli's prompts (it manages its own site + token storage).
Verify with:

```bash
acli jira auth status
```

## First commands

Dashboard (no args) - ambient snapshot of your Jira context (open work items, acli status):

```bash
jira-axi
```

List your Jira work items on a project (see [commands](./commands.md)):

```bash
jira-axi workitem list --project TEAM
```

View one item with comments:

```bash
jira-axi workitem view TEAM-1 --comments
```

Flags MUST come after the command: `jira-axi workitem list --project TEAM`, never `jira-axi --project TEAM workitem list`.
All structured output is TOON-encoded and token-efficient.

## `jira-axi setup hooks`

Installs or repairs agent SessionStart hooks that emit `jira-axi` ambient context.

```bash
jira-axi setup hooks
```

It writes SessionStart hooks for Claude Code (`~/.claude/settings.json`), Codex (`~/.codex/`), and OpenCode.
Each hook invokes the bin with no args, so the dashboard output becomes the agent's session-start context block.
An agent wants this so every session opens with current Jira context without an explicit call.
See [setup & update](./setup.md) for details.

## Verify it works

Confirm `acli` is authenticated and live access works via the dashboard:

```bash
jira-axi
```

It reports whether `acli` is installed and lists your open work items.
