# setup and update

Install agent session-start hooks and self-upgrade the CLI.

Scope: run `setup hooks` once per machine to make the tool advertise itself and current Jira/Confluence context to coding agents at session start.
Use `update` / `update --check` to keep the installed CLI current.
For authentication commands see [auth](./auth.md).

### `atlassian-axi setup hooks`

Install or repair SessionStart ambient-context hooks for coding agents.

```bash
atlassian-axi setup hooks
```

Writes hooks for Claude Code (`~/.claude/settings.json`), Codex (`~/.codex/`), and OpenCode.
Each hook target is `atlassian-axi` invoked with no arguments, so the dashboard output becomes the agent's session-start ambient block (the SDK prefixes it with `bin:` / `description:`).

Why run it: at the start of every agent session the tool advertises its own command surface plus your current Jira/Confluence context (open work items, spaces), so the agent knows the CLI exists and what state it is looking at without being told.

**Caveats:**
- Idempotent - safe to re-run; it installs if missing and repairs if present.
- Modifies real user config files under `~/.claude`, `~/.codex`, and OpenCode's config directory. This is a real filesystem write, not a dry run.

### `atlassian-axi update`

Upgrade the installed `atlassian-axi` CLI to the latest published npm version.
Inherited built-in from `axi-sdk-js`; not listed under `commands` in `--help`.

```bash
atlassian-axi update
```

**Caveats:**
- Installs the latest published version. Re-running when already current is a safe no-op.

### `atlassian-axi update --check`

Report the current installed version versus the latest published version without installing anything.

**Flags:**
- `--check` - report only; do not install.

```bash
atlassian-axi update --check
```

**Caveats:**
- Read-only. Makes no changes.
