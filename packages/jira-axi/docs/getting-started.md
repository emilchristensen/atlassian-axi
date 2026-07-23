# Getting started

`jira-axi` is an agent-ergonomic CLI wrapping Atlassian `acli` for Jira.

Use this doc to install, authenticate `acli`, and run your first commands.
For exhaustive flags see [commands](./commands.md) and [limitations](./limitations.md).

## Install

Install globally so a stable `jira-axi` bin lands on your `PATH` (recommended):

```bash
npm i -g jira-axi
```

A global install is what `setup hooks` needs: the SessionStart hooks it writes call a bare `jira-axi` command with no args, which only resolves when the bin is on `PATH`.

For a one-off command you can run `npx -y jira-axi <command>` without installing, but that is NOT recommended when you use `setup hooks` - `npx` does not give the hooks a stable command to call.

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
