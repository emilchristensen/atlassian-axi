# Benchmark: jira-axi / confluence-axi vs Atlassian Rovo MCP vs raw acli

Two comparisons of the three ways an agent can operate Atlassian: the AXI CLIs from this repo, the official Atlassian Rovo MCP server, and Atlassian's official `acli` used directly.

Versions measured: jira-axi 1.0.3, confluence-axi 1.0.3, acli 1.3.22-stable, Rovo MCP server 1.1.3 (its repo's `server.json`).
Regenerate the figures with `pnpm --filter @atlassian-axi/benchmark run bench`; the full method, raw artifacts, transcripts, and scoring live in [`packages/benchmark/`](https://github.com/emilchristensen/atlassian-axi/tree/main/packages/benchmark).

## Provenance labels - read this first

Every figure and cell in this document carries one of these labels.

- `measured` - produced live on 2026-08-05 against the installed CLIs and an authenticated Confluence/Jira Cloud site (identifiers redacted in committed artifacts).
- `derived-from-docs` - taken from Atlassian's published documentation; the value was not (and could not be) produced live here.
- `not-measured` / `not-rated` - no defensible value exists; the reason is stated inline.

**The MCP server could not be exercised live from this environment.**
Its auth is interactive OAuth, which cannot be completed here; an unauthenticated `tools/list` against `https://mcp.atlassian.com/v1/mcp` returned HTTP 401 (measured, 2026-08-05).
Consequently every MCP token figure is derived-from-docs, every MCP accuracy cell is `not-rated`, and **the accuracy comparison covers two of the three surfaces**.
An empty MCP accuracy column means "could not be driven", not "scored zero".

Token counting method, used identically for every figure: `gpt-tokenizer` with the `o200k_base` encoding, over the exact texts committed under `packages/benchmark/artifacts/`.
It approximates any specific model's tokenizer, but because one encoding counts every surface, the comparisons hold.

## Comparison 1: Jira

### Feature coverage

Cell markers: `[m]` = measured, `[d]` = derived-from-docs.
MCP cells come from the [supported-tools documentation](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/) (fetched 2026-08-05); "unsupported [d]" means no tool for the operation is documented there.

| Operation | jira-axi | MCP | acli |
|---|---|---|---|
| View a work item | supported [m] - `workitem view <KEY>` | supported [d] - `getJiraIssue` | supported [m] - `workitem view <KEY>` |
| JQL search | supported [m] - `workitem search "<JQL>"` | supported [d] - `searchJiraIssuesUsingJql` | supported [m] - `workitem search --jql` |
| Filtered list without hand-writing JQL | supported [m] - `workitem list --project/--assignee/--status` | unsupported [d] - raw JQL only | unsupported [m] - `search` requires `--jql` |
| Create a work item | supported [m] | supported [d] - `createJiraIssue` | supported [m] |
| Edit work item fields | supported [m] | supported [d] - `editJiraIssue` | supported [m] |
| Transition a work item | supported [m] - `transition <KEY> --to <status>` | supported [d] - `getTransitionsForJiraIssue` + `transitionJiraIssue` (two calls) | supported [m] - `transition --key --status` |
| Assign a work item | supported [m] - `assign <KEY> --assignee <email\|@me>` | partial [d] - `editJiraIssue` + `lookupJiraAccountId`, no dedicated tool | supported [m] - `assign` |
| Read comments | supported [m] - `view <KEY> --comments` | partial [d] - no comment-list tool documented; via `getJiraIssue` fields | supported [m] - `comment list --key` |
| Add a comment | supported [m] - `comment <KEY> --body` | supported [d] - `addCommentToJiraIssue` | supported [m] - `comment create --key --body` |
| Markdown body stored as rich text (ADF) | supported [m] - markdown converted to ADF | not-established [d] - accepted body format not documented | partial [m] - plain text or raw ADF JSON only |
| List/view projects | supported [m] | supported [d] - `getVisibleJiraProjects` | supported [m] |
| Project admin (create/update/delete/archive) | unsupported [m] | unsupported [d] | supported [m] - `project create/update/delete/archive/restore` |
| Boards | supported [m] | unsupported [d] | supported [m] |
| Sprints | supported [m] | unsupported [d] | supported [m] |
| Saved filters | supported [m] | unsupported [d] | supported [m] |
| Dashboards | supported [m] | unsupported [d] | supported [m] |
| Custom fields (create/update/delete/restore) | supported [m] | unsupported [d] | supported [m] |
| Worklogs | unsupported [m] | supported [d] - `addWorklogToJiraIssue` | unsupported [m] |
| Remote issue links | unsupported [m] | supported [d] - `getJiraIssueRemoteIssueLinks` | unsupported [m] |
| Link two work items | unsupported [m] | not-established [d] - `getIssueLinkTypes` is read-only; no create-link tool listed, though `createJiraIssue`'s published description mentions linking (likely a docs error) | supported [m] - `workitem link` |
| Work item attachments | unsupported [m] | unsupported [d] | supported [m] - `workitem attachment` |
| Bulk operations (bulk create, JQL-wide transition/comment) | unsupported [m] | unsupported [d] | supported [m] |
| Archive/unarchive/clone/delete work items, watchers | unsupported [m] | unsupported [d] | supported [m] |
| Resolve a user to an accountId | unsupported [m] | supported [d] - `lookupJiraAccountId` | unsupported [m] |

### Token cost

Entry cost - what the surface loads before the first operation (all figures o200k_base tokens):

| Surface | Tokens | Provenance | What was counted |
|---|---|---|---|
| jira-axi | 1214 | measured | the skill file an agent harness loads |
| acli (jira) | 286 | measured | `acli --help` + `acli jira --help` (no skill exists) |
| MCP (jira) | >= 503 | derived-from-docs | documented tool names + descriptions for the 2 common + 14 Jira tools; **lower bound** - the real injected `inputSchema` JSON is not published and could not be captured (401), so the schema overhead is not-measured |

Task-set discovery cost - the additional help screens needed to perform the representative tasks:

| Surface | Tokens | Provenance | Note |
|---|---|---|---|
| jira-axi | 478 | measured | `workitem --help`; optional - the skill already carries per-command usage |
| acli (jira) | 1625 | measured | the 7 subcommand help screens the task set touches |
| MCP | 0 | derived-from-docs | schemas already injected at entry |

acli wins the Jira entry-cost row outright (286 vs 1214), and the documented MCP lower bound (503) is also below the jira-axi skill.
The ordering reverses once discovery is included (jira-axi 1214 with usage included vs acli 1911), and in the live accuracy runs below the acli executor spent 25 commands where the jira-axi executor spent 5.

Per-operation output size (measured; tokens of the redacted output committed under `artifacts/raw/outputs/`):

| Task | jira-axi | acli | MCP |
|---|---|---|---|
| J1 view work item | 193 | 68 | not-measured - surface not drivable |
| J2 read comments | 236 | 282 | not-measured |
| J3 JQL search (4 results) | 157 | 716 | not-measured |

acli wins J1: its default view omits created/updated/priority and prints no follow-up suggestions.
jira-axi's J1 output includes those fields plus 4 suggested next commands.

Write-path error behaviour, probed on the guaranteed-nonexistent key NOPE-99999 (measured-error-probe; the write rows themselves are derived-from-docs since no live mutation was performed):

| Probe | jira-axi | acli |
|---|---|---|
| Transition nonexistent item | 65 tokens, exit 1 | 27 tokens, **exit 0** despite printing `✗ Failure: ... Issue does not exist` |
| Comment on nonexistent item | 65 tokens, exit 1 | 14 tokens, exit 1 |

The acli transition exit-0-on-failure is a measured agent-relevant hazard: an agent checking exit codes sees success on a failed transition.

### Accuracy

Rating scale, expectations, and per-task detail: [`packages/benchmark/artifacts/expectations.md`](https://github.com/emilchristensen/atlassian-axi/blob/main/packages/benchmark/artifacts/expectations.md) (declared before any run) and [`scoring.md`](https://github.com/emilchristensen/atlassian-axi/blob/main/packages/benchmark/artifacts/scoring.md); transcripts under `artifacts/transcripts/`.
One run per task per surface, executor model claude-fable-5 - indicative, not statistical.

| Surface | Result (5 Jira tasks) | Executor commands | Provenance |
|---|---|---|---|
| jira-axi | 5 correct | 5 | measured |
| acli | 5 correct | 25 | measured |
| MCP | not-rated - interactive OAuth cannot be completed here | - | - |

Both drivable surfaces were fully accurate on the Jira task set; the difference is discovery effort, not correctness.

## Comparison 2: Confluence

### The acli page-read-only gap

This is a first-class result, not a footnote, and it is the core of this comparison.
acli 1.3.22-stable has a Confluence command tree, but its page surface is read-only: `acli confluence page` exposes exactly one subcommand, `view` (measured from its help output).

```
acli confluence page   -> view  (only)
acli confluence space  -> archive, create, list, restore, update, view
acli confluence blog   -> create, list, view
```

Measured consequences at subcommand granularity:

- No page create, update, or delete.
- No CQL search anywhere in the tree.
- No attachment listing (no command, and no `--include-*` flag of `page view` covers attachments).
- No label mutations; label and direct-children reads exist only as `page view --include-labels` / `--include-direct-children`, and those flags' data is silently absent unless `--json` is also passed (measured).

### Feature coverage

| Operation | confluence-axi | MCP | acli |
|---|---|---|---|
| Read a page by id | supported [m] - `page get <id>` | supported [d] - `getConfluencePage` | supported [m] - `page view --id` (its only page subcommand) |
| Create a page | supported [m] - `page create` | supported [d] - `createConfluencePage` | unsupported [m] |
| Update a page | supported [m] - `page update` (macro-loss guard) | supported [d] - `updateConfluencePage` | unsupported [m] |
| Delete a page | supported [m] - `page delete` | unsupported [d] - no delete tool documented | unsupported [m] |
| CQL search | supported [m] - `search "<CQL>"` | supported [d] - `searchConfluenceUsingCql` | unsupported [m] |
| List a page's children | supported [m] - `page children` | supported [d] - `getConfluencePageDescendants` | partial [m] - `page view --include-direct-children --json` |
| List a page's attachments | supported [m] - `page attachments` | unsupported [d] | unsupported [m] |
| List a page's labels | supported [m] - `page labels` | unsupported [d] | partial [m] - `page view --include-labels --json` |
| Add/remove page labels | supported [m] - `page labels --add/--remove` | unsupported [d] | unsupported [m] |
| List spaces | supported [m] - `space list` | supported [d] - `getConfluenceSpaces` | supported [m] - `space list` |
| List pages in a space | supported [m] - via CQL | supported [d] - `getPagesInConfluenceSpace` | partial [m] - recursive tree walk via homepage + `--include-direct-children` (demonstrated in transcript A-C2-acli) |
| Space admin (create/update/archive/restore) | unsupported [m] | unsupported [d] | supported [m] |
| Blog posts (create/list/view) | unsupported [m] | partial [d] - CQL can find blog posts; no create tool | supported [m] |
| Page comments (footer and inline) | unsupported [m] | supported [d] - 5 comment tools | unsupported [m] |
| Page version history | partial [m] - current version number only | not-established [d] | partial [m] - `--include-versions`, point-in-time reads via `--version <n>` |
| Natural-language cross-product search | unsupported [m] | supported [d] - `searchAtlassian` (beta) | unsupported [m] |

### Token cost

Entry cost:

| Surface | Tokens | Provenance | What was counted |
|---|---|---|---|
| confluence-axi | 1455 | measured | the skill file |
| acli (confluence) | 262 | measured | `acli --help` + `acli confluence --help` |
| MCP (confluence) | >= 416 | derived-from-docs | names + descriptions of the 2 common + 12 Confluence tools; lower bound, schema overhead not-measured (401) |

Task-set discovery cost:

| Surface | Tokens | Provenance |
|---|---|---|
| confluence-axi | 635 (optional; skill carries usage) | measured |
| acli (confluence) | 728 | measured |
| MCP | 0 | derived-from-docs |

acli wins the Confluence entry-cost row, and even its combined entry + discovery (990) is below the confluence-axi skill alone (1455).
The context saving buys a surface that cannot perform 4 of the 8 representative Confluence operations at all (search, attachments, create, update).

Per-operation output size (measured):

| Task | confluence-axi | acli | MCP |
|---|---|---|---|
| C1 read page | 398 | 474 | not-measured - surface not drivable |
| C2 CQL search (5 results) | 258 | n/a - unsupported (the attempted command errors in 89 tokens) | not-measured |
| C3 list children | 104 | 509 | not-measured |
| C4 list labels | 34 | 342 | not-measured |
| C5 list attachments | 98 | n/a - unsupported | not-measured |
| C6 list spaces | 151 | 617 | not-measured |

Write-path error behaviour, probed on nonexistent targets (measured-error-probe; write rows derived-from-docs):

| Probe | confluence-axi | acli |
|---|---|---|
| Create in nonexistent space | 47 tokens, exit 1, names the unknown space | n/a - no create command (unknown-command error, 14 tokens) |
| Update nonexistent page | 69 tokens, exit 1 | n/a - no update command |

### Accuracy

| Surface | Result (7 Confluence tasks) | Executor commands | Provenance |
|---|---|---|---|
| confluence-axi | 7 correct | 6 | measured |
| acli | 7 correct - but 4 of the 7 are correct *reports that the operation is unsupported*; the requested result was produced on 3 tasks directly plus 1 via a tree-traversal workaround | 51 | measured |
| MCP | not-rated - interactive OAuth cannot be completed here | - | - |

Per the pre-declared scale, correctly proving an operation impossible scores `correct`; the coverage matrix above is where that limitation is visible.

## Setup burden

Stated factually; all `measured` on this machine except where noted.

| Surface | Install | Auth | MCP client config |
|---|---|---|---|
| jira-axi | none needed - `npx -y jira-axi@latest`; requires Node >= 20 and acli (`brew install acli`) | delegated entirely to `acli jira auth login`; no credential setup of its own | n/a |
| confluence-axi | none needed - `npx -y confluence-axi@latest`; requires Node >= 20 | `auth login --token` with site + email + API token via stdin, or OAuth 3LO with a self-registered app (`ATLASSIAN_AXI_OAUTH_CLIENT_ID`, secret via env or one-time prompt) | n/a |
| acli | `brew install acli` | `acli jira auth login` (OAuth browser flow or API token); a single API-token login served both Jira and Confluence commands here (measured) | n/a |
| MCP | none (hosted server) | interactive OAuth in a browser on first connect (derived-from-docs; unauthenticated access measured as HTTP 401) | requires an MCP-capable client configured with `https://mcp.atlassian.com/v1/mcp` (derived-from-docs) |

## Rows where a competitor surface wins

- Entry-level context cost: acli wins both products (286 and 262 tokens vs 1214 and 1455 for the AXI skills); the documented MCP lower bounds also sit below the skills.
- Per-operation output size: acli wins J1 (68 vs 193 tokens).
- Jira capability rows won by acli alone: project admin, work item attachments, issue links, bulk operations, archive/clone/delete/watchers.
- Jira capability rows won by MCP alone: worklogs, remote issue links, accountId lookup.
- Confluence capability rows won by acli alone: space admin, blog posts.
- Confluence capability rows won by MCP alone: page comments (footer and inline), natural-language cross-product search.
- MCP is the only surface with zero task-time discovery cost: its schemas are pre-injected, where both CLIs may spend help-screen tokens.

## Reproducing

```
pnpm install && pnpm run build
pnpm --filter @atlassian-axi/benchmark run bench
```

`bench` regenerates the context-cost, output-cost, and coverage figures from the committed data and a live authenticated site; see [`packages/benchmark/README.md`](https://github.com/emilchristensen/atlassian-axi/blob/main/packages/benchmark/README.md) for the accuracy-run protocol, redaction rules, and what changes when the live site's data differs.
The benchmark package is private and unpublished; neither published package's `dependencies` nor `files` array references it or the tokenizer (verified by inspection of both `package.json` files, whose `files` arrays contain only `dist`, `skills/<name>`, `LICENSE`, `README.md`).
No Jira work item or Confluence page was created, updated, or deleted during measurement; write paths were exercised only against guaranteed-nonexistent targets.
