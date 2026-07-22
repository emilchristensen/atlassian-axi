# setup and update

Install agent session-start hooks and self-upgrade the CLI.

Scope: run `setup hooks` once per machine to make the tool advertise itself and current Confluence context to coding agents at session start.
Use `update` / `update --check` to keep the installed CLI current.
For authentication commands see [auth](./auth.md).

## `confluence-axi setup hooks`

Install or repair SessionStart ambient-context hooks for coding agents.

```bash
confluence-axi setup hooks
```

Writes hooks for Claude Code (`~/.claude/settings.json`), Codex (`~/.codex/`), and OpenCode.
Each hook target is `confluence-axi` invoked with no arguments, so the dashboard output becomes the agent's session-start ambient block (the SDK prefixes it with `bin:` / `description:`).

Why run it: at the start of every agent session the tool advertises its own command surface plus your current Confluence context (spaces), so the agent knows the CLI exists and what state it is looking at without being told.

Each target is written independently, so read the reported `status`:
`status: installed` means every target was written.
`status: partial` means at least one was not, and a `failures[n]:` block names each one (usually a malformed JSON/TOML config or a permissions problem); the remaining integrations are installed.
The `integrations:` line always lists what was attempted, not what succeeded - the `failures[n]:` block is what tells you which targets are missing.

**Caveats:**
- Idempotent - safe to re-run; it installs if missing and repairs if present. Fix the file named in a failure and re-run.
- A partial install still exits 0, so check the `status` line rather than the exit code.
- Modifies real user config files under `~/.claude`, `~/.codex`, and OpenCode's config directory. This is a real filesystem write, not a dry run.

## `confluence-axi update`

Upgrade the installed `confluence-axi` CLI to the latest published npm version.
Inherited built-in from `axi-sdk-js`; not listed under `commands` in `--help`.

```bash
confluence-axi update
```

**Caveats:**
- Installs the latest published version. Re-running when already current is a safe no-op.

## `confluence-axi update --check`

Report the current installed version versus the latest published version without installing anything.

**Flags:**
- `--check` - report only; do not install.

```bash
confluence-axi update --check
```

**Caveats:**
- Read-only. Makes no changes.
