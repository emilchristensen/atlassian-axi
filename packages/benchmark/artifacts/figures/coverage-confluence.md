| Operation | confluence-axi | MCP | acli |
|---|---|---|---|
| Read a page by id | supported [m] - page get <id> [--full] [--format storage|adf] | supported [d] - getConfluencePage | supported [m] - page view --id <id> (its only page subcommand) |
| Create a page | supported [m] - page create --space <KEY> --title ... --body/--body-file [--parent <id>] | supported [d] - createConfluencePage | unsupported [m] - no page create subcommand (page is view-only) |
| Update a page (title or body) | supported [m] - page update <id> [--title] [--body|--body-file] (full-body replace with macro-loss guard) | supported [d] - updateConfluencePage | unsupported [m] - no page update subcommand |
| Delete a page | supported [m] - page delete <id> | unsupported [d] - no delete tool documented | unsupported [m] - no page delete subcommand |
| CQL search | supported [m] - search "<CQL>" [--limit] [--fields] | supported [d] - searchConfluenceUsingCql | unsupported [m] - no search command anywhere in the confluence tree |
| List a page's children | supported [m] - page children <id> [--limit] | supported [d] - getConfluencePageDescendants | partial [m] - page view --id <id> --include-direct-children (direct children only, embedded in the view payload) |
| List a page's attachments | supported [m] - page attachments <id> [--filename] [--media-type] | unsupported [d] - no attachment tools documented | unsupported [m] - no attachment subcommand or view flag |
| List a page's labels | supported [m] - page labels <id> [--prefix] | unsupported [d] - no label tools documented | partial [m] - page view --id <id> --include-labels (embedded in the view payload) |
| Add/remove page labels | supported [m] - page labels <id> --add/--remove <name,...> | unsupported [d] - no label tools documented | unsupported [m] - no label mutation anywhere |
| List spaces | supported [m] - space list [--fields] | supported [d] - getConfluenceSpaces | supported [m] - space list |
| List pages in a space | supported [m] - search "space = <KEY> and type = page" | supported [d] - getPagesInConfluenceSpace | partial [m] - no page list, but the tree can be walked: space list --expand homepage gives the homepage id, then recursive page view --include-direct-children --json enumerates it (demonstrated live in transcript A-C2-acli) |
| Space admin (create/update/archive/restore) | unsupported [m] - space is list-only | unsupported [d] - no space-admin tools documented | supported [m] - space create/update/archive/restore |
| Blog posts (create/list/view) | unsupported [m] - no blog command | partial [d] - CQL search can find blog posts (type = blogpost); no create tool documented | supported [m] - blog create/list/view |
| Page comments (footer and inline) | unsupported [m] - no comment commands | supported [d] - getConfluencePageFooterComments/InlineComments, createConfluenceFooterComment/InlineComment, getConfluenceCommentChildren | unsupported [m] - no comment commands |
| Page version history | partial [m] - page get shows the current version number only | not-established [d] - docs do not state whether getConfluencePage returns version history | partial [m] - page view --include-versions / --version <n> (versions list and point-in-time reads) |
| Natural-language cross-product search | unsupported [m] - CQL only | supported [d] - searchAtlassian (beta, Rovo) | unsupported [m] - no search at all |

Provenance markers: `[m]` = measured, `[d]` = derived-from-docs.
- measured: verified live against the installed CLI (confluence-axi 1.0.3 from this repo, acli 1.3.22-stable) via its help output or a live read-only invocation on 2026-08-05
- derived-from-docs: taken from the Atlassian Rovo MCP Server supported-tools documentation (fetched 2026-08-05); the server could not be driven here

acli page-read-only gap: acli 1.3.22-stable has a Confluence command tree, but its page commands are READ-ONLY: `acli confluence page` exposes exactly one subcommand, `view`. There is no acli command for creating, updating, or deleting a page, no CQL search, no attachment listing, and no label mutation. Its Confluence write surface is spaces (archive/create/list/restore/update/view) and blogs (create/list/view) only. Verified live from `acli confluence --help` and `acli confluence page --help` on 2026-08-05.
