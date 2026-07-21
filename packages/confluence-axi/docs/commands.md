# confluence-axi commands

Confluence Cloud page, space, and search operations against the Confluence REST API directly.

Use for reading and mutating Confluence pages, listing spaces, and CQL search.
Requires configured auth (see [auth](./auth.md)).
The `--site` flag retargets Confluence (flag > env > stored).

## API version model

Two API versions are used by design:

- v2 (`/wiki/api/v2/...`) backs page and space CRUD, `page attachments`, `page children`, and label listing.
- v1 (`/wiki/rest/api/...`) backs CQL `search` and label mutations. The v2 API has NO search endpoint.

`page create --space <KEY>` resolves the space KEY to a numeric `spaceId` internally before the v2 create call.
v2 collection listings (`space list`, `page attachments`, `page children`, label listing) paginate by cursor and return NO total count.

## Page body format

Page bodies are storage-format XHTML by default.
`page get --format adf` returns Atlas Doc Format instead.

Markdown is NOT converted for Confluence page bodies.
Passing markdown to `--body`/`--body-file` stores it literally as text and is user error.

## page

### `confluence-axi page get <id>`

Fetch a single page by numeric id.

**Flags:**
- `--full` - return the complete body without truncation.
- `--format <storage|adf>` - body format. Default `storage`.

```bash
confluence-axi page get 12345 --full
```

**Caveats:**
- A trashed page returns 200 with `status: "trashed"` (it is not treated as absent by `get`).
- Run `page get <id> --full` before `page update` to capture the current body, including any embedded macros. See the macro-loss guard below.

### `confluence-axi page create`

Create a page in a space.

**Flags:**
- `--space <KEY>` (required) - space key; resolved to numeric spaceId internally.
- `--title <text>` (required).
- `--body <text>` or `--body-file <path>` (required) - storage-format XHTML. Provide exactly one.
- `--parent <id>` - parent page id.

```bash
confluence-axi page create --space ENG --title "Release notes" --body-file notes.html
```

**Caveats:**
- If a page with the same title already exists in the space, the existing page is reported instead of creating a duplicate.
- A create POST without space create-permission returns 404 from Confluence; this is re-mapped to FORBIDDEN (the space and duplicate pre-checks already passed, so the id is valid).
- `--body`/`--body-file` is storage-format XHTML, not markdown. See "Page body format" above.

### `confluence-axi page update <id>`

Full-body replace of a page. The version number is bumped automatically.

**Flags:**
- `--title <text>` - new title.
- `--body <text>` or `--body-file <path>` - storage-format XHTML. Provide exactly one. At least one of `--title`/`--body` is required.
- `--allow-macro-loss` - permit dropping an embedded macro the current body still has. Blocked by default.

```bash
# 1. Read the current body. Output is TOON (the body is a field), NOT raw XHTML,
#    so do not redirect it straight to a file - read the body value out of it.
confluence-axi page get 12345 --full
# 2. Build the new storage-format XHTML yourself, keeping any <ac:structured-macro> blocks,
#    write it to body.html, then replace the body.
confluence-axi page update 12345 --body-file body.html
```

**Macro-loss guard (most important gotcha):**
`page update` replaces the ENTIRE body.
If the new body drops an `<ac:structured-macro>` (an embedded whiteboard, diagram, or macro) that the current page still has, the update is REFUSED with VALIDATION_ERROR unless `--allow-macro-loss` is passed.
Macros are compared by `ac:name` count, so dropping one of two identical embeds is still caught.
Correct pattern: `page get <id> --full` first, carry the macro block into the new body, then update.
Use `--allow-macro-loss` only to drop a macro intentionally.
See [limitations](./limitations.md).

**Caveats:**
- No-op success: if title and body are unchanged, the update succeeds without incrementing the version.
- A title-only edit keeps the existing body and never triggers the macro-loss guard.

### `confluence-axi page delete <id>`

Delete (trash) a page by id.

```bash
confluence-axi page delete 12345
```

**Caveats:**
- Idempotent: a page that is already trashed or genuinely gone is reported as "Already deleted".
- A bare 404 is NOT proof of absence. Confluence returns 404 (not 403) for a DELETE without delete-permission. After a DELETE 404 the page is re-read; "Already deleted" is only claimed when the page is actually gone, otherwise FORBIDDEN is reported.

### `confluence-axi page attachments <id>`

List attachments on a page. Read-only.

**Flags:**
- `--limit <n>` - max results. Default 30.
- `--media-type <type>` - filter by media type.
- `--filename <name>` - filter by filename.

```bash
confluence-axi page attachments 12345 --media-type image/png
```

**Caveats:**
- Read-only. Attachment UPLOAD is not supported; upload in the Confluence UI. See [limitations](./limitations.md).
- Cursor-paginated with no total count.

### `confluence-axi page labels <id>`

List or mutate page labels. With no flags, lists labels.

**Flags:**
- `--add <name,name,...>` - add labels. Idempotent. Mutually exclusive with `--remove`.
- `--remove <name,name,...>` - remove labels. Idempotent. Mutually exclusive with `--add`.
- `--prefix <my|team|global|system>` - filter listing by prefix. List only.
- `--limit <n>` - max results when listing. Default 30.

```bash
confluence-axi page labels 12345
confluence-axi page labels 12345 --add release,july
confluence-axi page labels 12345 --remove draft
```

**Caveats:**
- Mutations manage GLOBAL-prefix labels only. `--prefix` is list-only and does not scope a mutation.
- Idempotent: adding an already-present label or removing an absent one is reported and succeeds.
- After a mutation the authoritative label set is re-fetched and rendered; the mutation response itself is not parsed.

### `confluence-axi page children <id>`

List child pages of a page.

**Flags:**
- `--limit <n>` - max results. Default 30.

```bash
confluence-axi page children 12345
```

**Caveats:**
- Cursor-paginated with no total count.

## space

### `confluence-axi space list`

List spaces.

**Flags:**
- `--limit <n>` - max results. Default 30.

```bash
confluence-axi space list --limit 50
```

**Caveats:**
- Cursor-paginated with no total count.

## search

### `confluence-axi search "<CQL>"`

CQL search across Confluence (v1 REST; the v2 API has no search endpoint).

**Flags:**
- `--limit <n>` - max results. Default 30.

```bash
confluence-axi search "space = ENG AND type = page"
confluence-axi search "title ~ 'release notes'" --limit 5
confluence-axi search "text ~ 'pagination' AND lastmodified >= now('-30d')"
```

**Caveats:**
- The query is CQL, not JQL and not a plain keyword string.
- Highlight markers Confluence adds around matched title/excerpt text are stripped from output.
