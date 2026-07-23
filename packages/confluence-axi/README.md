# confluence-axi

Agent-ergonomic CLI for Confluence Cloud, calling the Confluence REST API directly.
Token-efficient TOON output, contextual suggestions, and idempotent mutations.

> Sunset note: this replaces the Confluence half of the combined `atlassian-axi` CLI, which is now sunset and split into two per-product bins.
> The Jira half is the separate `jira-axi` package.

## Install

No global install needed. Run through `npx`:

```bash
npx -y confluence-axi <command>
```

Node >= 20. Nothing else required; there is no `acli` dependency.

## Auth

Two modes. Resolution order: `ATLASSIAN_API_TOKEN` env > OAuth session > stored API token.

- API token (agents / CI): non-interactive, token read from stdin only, never as an argument.

  ```bash
  echo -n "$TOKEN" | confluence-axi auth login --token --site acme.atlassian.net --email me@acme.com
  ```

- OAuth browser (humans): needs an interactive TTY, and your own registered Atlassian 3LO app (there is no shipped default). Set `ATLASSIAN_AXI_OAUTH_CLIENT_ID` and supply the secret.

  ```bash
  export ATLASSIAN_AXI_OAUTH_CLIENT_ID=<your app client id>
  confluence-axi auth login
  ```

See [docs/auth.md](./docs/auth.md) for the resolution order, env vars, storage, `--site`, registering your own app, and the threat model.

## Commands

```
confluence-axi page get <id> [--full] [--format storage|adf]
confluence-axi page create --space <KEY> --title <text> (--body <xhtml> | --body-file <path>) [--parent <id>]
confluence-axi page update <id> [--title <text>] [(--body <xhtml> | --body-file <path>)] [--allow-macro-loss]
confluence-axi page delete <id>
confluence-axi page attachments <id> [--limit <n>] [--media-type <type>] [--filename <name>]
confluence-axi page labels <id> [--add a,b | --remove a,b] [--prefix my|team|global|system] [--limit <n>]
confluence-axi page children <id> [--limit <n>]
confluence-axi space list [--limit <n>] [--fields <a,b,c>]
confluence-axi search "<CQL>" [--limit <n>] [--fields <a,b,c>]
confluence-axi auth login | login --token | status | logout
confluence-axi setup hooks
confluence-axi update [--check]
```

Flags come AFTER the command. Per-command help: `confluence-axi <command> --help`, scoped to the subcommand when you name one (`confluence-axi page get --help`).

## Output and idempotency

All structured output is TOON-encoded and token-efficient; there is no plain-text or JSON mode.
Bodies truncate by default; pass `--full` on `page get`.
Mutations are idempotent: a no-op mutation reports "Already ..." and re-fetches the authoritative post-state, so re-running a failed mutation is safe.

## Macro-loss guard

`page update` is a full-body replace.
If the new body drops an `<ac:structured-macro>` (an embedded whiteboard, diagram, or macro) the current page still has, the update is REFUSED with VALIDATION_ERROR unless `--allow-macro-loss` is passed.
Correct pattern: `page get <id> --full`, carry the macro block into the new body, then `page update --body-file`.
This CLI cannot create or edit diagrams/whiteboards, only preserve them.

## Body format

Confluence page bodies are storage-format XHTML (or Atlas Doc Format via `--format adf`).
Markdown is NOT converted; passing markdown stores it literally.

## Docs

- [docs/index.md](./docs/index.md) - documentation home.
- [docs/getting-started.md](./docs/getting-started.md) - install, auth quickstart, first commands, hooks, verify.
- [docs/commands.md](./docs/commands.md) - full `page` / `space` / `search` reference.
- [docs/auth.md](./docs/auth.md) - auth modes, env vars, storage, `--site`, registering your own OAuth app, threat model.
- [docs/limitations.md](./docs/limitations.md) - what the tool deliberately cannot do.
- [docs/setup.md](./docs/setup.md) - `setup hooks`, `update`.

## License

MIT
