<!-- provenance: measured accuracy run; executor final message verbatim (then redacted per src/redact.ts; repeated help screens and non-essential JSON payloads elided where marked); task A-C5, surface acli, executor model claude-fable-5, 2026-08-05 -->
# Transcript
## $ acli --help
```
(same top-level help as in A-C1-acli.md)
```
## $ acli confluence --help
```
(same confluence group help as in A-C1-acli.md - subcommands auth, blog, page, space; no attachment command)
```
## $ acli confluence page --help
```
(same page group help as in A-C1-acli.md - single subcommand: view)
```
## $ acli confluence page view --help
```
(same page view help as in A-C1-acli.md; the --include-* family covers collaborators, direct children, favorited status, labels, likes, operations, properties, version(s), and webresources - no attachments option)
```
## $ acli confluence space --help; echo ---; acli confluence blog --help
```
(same space group help - archive/create/list/restore/update/view - and blog group help - create/list/view - as in A-C2-acli.md)
```
## $ acli confluence page view --id 18753814575 --json
```
(JSON page object for "Configuration", body {}; no attachment data)
```
## $ acli confluence page view --id 18753814575 --body-format storage --json
```
(JSON page object; body.storage.value = "This page contains draw.io configuration file (configuration.json) as attachment"; no attachment data)
```
## $ acli confluence page view --id 18753814575 --include-properties --include-webresources --json
```
(JSON page object; properties.results = [], webResources = Confluence web-asset script/CSS tags; no attachment data)
```
## $ acli confluence attachment --help
```
(falls back to the generic `acli confluence` group help - proving no attachment command exists)
```
# FINAL ANSWER
The CLI cannot do this. `acli` has no command or flag that lists a Confluence page's attachments.

Proof from the help output:
- `acli confluence --help` shows the complete Confluence command set: `auth`, `blog`, `page`, `space` - no `attachment` command (confirmed by `acli confluence attachment --help` falling back to the generic help).
- `acli confluence page --help` shows `page` has exactly one subcommand: `view`.
- `acli confluence page view --help` lists every available flag; the `--include-*` options cover collaborators, direct children, favorited status, labels, likes, operations, properties, version(s), and webresources - there is no attachments option, and none of the executed `page view` invocations (plain, `--body-format storage`, `--include-properties --include-webresources`) returned any attachment data.

The only attachment-related information obtainable is indirect and non-authoritative: the page's own body text ("Configuration", space DRAWIOCONFIG) reads "This page contains draw.io configuration file (configuration.json) as attachment", suggesting an attachment named `configuration.json` - but this is page prose, not an actual attachment listing, so the true attachment list cannot be verified with this CLI.
