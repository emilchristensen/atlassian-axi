import { takeBody } from "../../body.js";
import { confluenceJson } from "../../confluence.js";
import type { SiteContext } from "../../context.js";
import { AxiError } from "../../errors.js";
import { getSuggestions } from "../../suggestions.js";
import {
  field,
  renderDetail,
  renderHelp,
  renderOutput,
} from "../../toon.js";
import { parseFlags, unknownSubcommandError } from "../shared.js";
import { attachmentsPage, childrenPage, labelsPage } from "./page-extras.js";
import {
  pageDetailSchema,
  requirePageId,
  resultsOf,
  strictBodyValueOf,
  versionOf,
  type JsonRecord,
} from "./shared.js";

export const PAGE_HELP = `usage: atlassian-axi confluence page <subcommand> [flags]
subcommands[7]:
  get <id>, create, update <id>, delete <id>, attachments <id>, labels <id>, children <id>
flags{get}:
  --full (complete body without truncation), --format <storage|adf> (default storage)
flags{create}:
  --space <KEY> (required), --title <text> (required), --body <text> or --body-file <path> (storage format; required), --parent <id>
flags{update}:
  --title <text>, --body <text> or --body-file <path> (storage format; at least one required; version bump is automatic), --allow-macro-loss (permit dropping an embedded macro/whiteboard the current body still has; blocked by default)
flags{attachments}:
  --limit <n> (default 30), --media-type <type>, --filename <name>
flags{labels}:
  (no flags = list) --add <name,name,...> or --remove <name,name,...> (idempotent; exclusive; mutations manage GLOBAL-prefix labels only), --prefix <my|team|global|system> (list only), --limit <n> (list only, default 30)
flags{children}:
  --limit <n> (default 30)
examples:
  atlassian-axi confluence page get 12345
  atlassian-axi confluence page create --space ENG --title "Release notes" --body-file notes.html
  atlassian-axi confluence page update 12345 --body "<p>Updated</p>"
  atlassian-axi confluence page labels 12345 --add release,july
  atlassian-axi confluence page children 12345`;

export async function pageCommand(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const sub = args[0];

  if (!sub || sub === "--help") {
    return PAGE_HELP;
  }

  switch (sub) {
    case "get":
      return getPage(args, ctx);
    case "create":
      return createPage(args, ctx);
    case "update":
      return updatePage(args, ctx);
    case "delete":
      return deletePage(args, ctx);
    case "attachments":
      return attachmentsPage(args, PAGE_HELP, ctx);
    case "labels":
      return labelsPage(args, PAGE_HELP, ctx);
    case "children":
      return childrenPage(args, PAGE_HELP, ctx);
    default:
      throw unknownSubcommandError(
        "page subcommand",
        sub,
        ["get", "create", "update", "delete", "attachments", "labels", "children"],
        "atlassian-axi confluence page --help",
      );
  }
}

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

/** Map the user-facing --format value to the REST body-format parameter. */
function resolveRepresentation(raw: string | undefined): string {
  if (raw === undefined || raw === "storage") return "storage";
  if (raw === "adf") return "atlas_doc_format";
  throw new AxiError(`Invalid --format: ${raw}`, "VALIDATION_ERROR", [
    "Use --format storage (XHTML) or --format adf (Atlas Doc Format)",
  ]);
}

/**
 * Names of structured macros present in `current` storage-format body but
 * absent from `next`. Identity is the macro's `ac:name` keyed by count, so
 * dropping one of two identical embeds is still caught. Used to guard
 * `page update` against silently deleting an embedded whiteboard/diagram.
 */
function droppedMacros(current: string | null, next: string): string[] {
  const names = (xhtml: string): string[] => {
    const out: string[] = [];
    const re = /<ac:structured-macro\b[^>]*\bac:name="([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xhtml)) !== null) out.push(m[1] ?? "");
    return out;
  };
  if (!current) return [];
  const remaining = names(next);
  const dropped: string[] = [];
  for (const name of names(current)) {
    const i = remaining.indexOf(name);
    if (i === -1) dropped.push(name);
    else remaining.splice(i, 1);
  }
  return dropped;
}

/** Fetch one page by id with its body in the given representation. */
async function fetchPage(
  id: string,
  representation: string,
): Promise<JsonRecord> {
  const page = await confluenceJson<JsonRecord>(`/wiki/api/v2/pages/${id}`, {
    query: { "body-format": representation },
  });
  if (!page || typeof page !== "object") {
    throw new AxiError(`Page not found: ${id}`, "NOT_FOUND");
  }
  return page;
}

/**
 * Probe whether a page is still LIVE after an ambiguous DELETE 404.
 * A trashed page still answers GET with 200 + status "trashed" (verified
 * live on dept-dk 2026-07-19), so status decides — only a `current` page
 * counts as existing. Returns false on a clean NOT_FOUND; any other failure
 * rethrows so a network blip is never mistaken for a successful delete.
 */
async function pageStillExists(id: string): Promise<boolean> {
  try {
    const page = await fetchPage(id, "storage");
    return page.status === "current";
  } catch (error) {
    if (error instanceof AxiError && error.code === "NOT_FOUND") {
      return false;
    }
    throw error;
  }
}

/**
 * Resolve a space key to its numeric v2 id (create needs the id). The v2
 * `keys` filter is exact-match and space keys are usually uppercase, so a
 * lowercase miss is retried uppercased — but only as a fallback, because
 * personal-space keys (`~jdoe`) are legitimately lowercase.
 */
async function resolveSpaceId(key: string): Promise<string> {
  const id = await lookupSpaceId(key);
  if (id !== null) {
    return id;
  }
  const upper = key.toUpperCase();
  if (upper !== key) {
    const upperId = await lookupSpaceId(upper);
    if (upperId !== null) {
      return upperId;
    }
  }
  throw new AxiError(`Space not found: ${key}`, "NOT_FOUND", [
    "Space keys are case-sensitive (usually uppercase)",
    "Run `atlassian-axi confluence space list` to see available space keys",
  ]);
}

async function lookupSpaceId(key: string): Promise<string | null> {
  const payload = await confluenceJson<unknown>("/wiki/api/v2/spaces", {
    query: { keys: key, limit: 1 },
  });
  const id = resultsOf(payload)[0]?.id;
  return id === undefined || id === null ? null : String(id);
}

function renderPage(
  page: JsonRecord,
  options: {
    full?: boolean;
    representation?: string;
    message?: string;
    ctx?: SiteContext;
    action: string;
  },
): string {
  const schema = pageDetailSchema(
    options.full ?? false,
    options.representation ?? "storage",
  );
  const item = options.message
    ? { ...page, _message: options.message }
    : page;
  const defs = options.message
    ? [...schema, field("_message", "message")]
    : schema;
  return renderOutput([
    renderDetail("page", item, defs),
    renderHelp(
      getSuggestions({
        domain: "page",
        action: options.action,
        id: String(page.id ?? ""),
        site: options.ctx,
      }),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

async function getPage(args: string[], ctx?: SiteContext): Promise<string> {
  const parsed = parseFlags(args, {
    values: ["--format"],
    bools: ["--full"],
  });
  if (parsed.help) return PAGE_HELP;

  const id = requirePageId(args, parsed.positional, "get");
  const representation = resolveRepresentation(parsed.values["--format"]);
  const page = await fetchPage(id, representation);
  return renderPage(page, {
    full: parsed.bools["--full"],
    representation,
    ctx,
    action: "get",
  });
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

async function createPage(args: string[], ctx?: SiteContext): Promise<string> {
  // valueBoundaryFlags keeps `--body --space ENG` from swallowing the sibling
  // flag as the body text (it errors with "--body requires text" instead).
  const body = takeBody(args, {
    label: "page body",
    valueBoundaryFlags: ["--space", "--title", "--parent"],
  });
  const parsed = parseFlags(args, {
    values: ["--space", "--title", "--parent"],
  });
  if (parsed.help) return PAGE_HELP;

  const space = parsed.values["--space"];
  const title = parsed.values["--title"];
  const parent = parsed.values["--parent"];

  const missing = [
    !space ? "--space" : null,
    !title ? "--title" : null,
    body === undefined ? "--body/--body-file" : null,
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new AxiError(
      `Missing required flags: ${missing.join(", ")}`,
      "VALIDATION_ERROR",
      [
        'Run `atlassian-axi confluence page create --space <KEY> --title "..." --body-file <path>`',
      ],
    );
  }

  const spaceId = await resolveSpaceId(space as string);

  // Idempotent: an existing CURRENT page with this exact title in the space
  // is reported instead of duplicated, so re-running a failed create is safe.
  // status=current keeps an archived same-title page from dead-ending create
  // forever (the v2 default includes archived pages).
  const existing = resultsOf(
    await confluenceJson<unknown>("/wiki/api/v2/pages", {
      query: {
        "space-id": spaceId,
        title: title as string,
        status: "current",
        limit: 1,
      },
    }),
  )[0];
  if (existing) {
    const page = await fetchPage(String(existing.id), "storage");
    return renderPage(page, {
      message: `Already exists in ${space}`,
      ctx,
      action: "create",
    });
  }

  let created: JsonRecord;
  try {
    created = await confluenceJson<JsonRecord>("/wiki/api/v2/pages", {
      method: "POST",
      body: {
        spaceId,
        status: "current",
        title,
        ...(parent ? { parentId: parent } : {}),
        body: { representation: "storage", value: body },
      },
    });
  } catch (error) {
    // The space resolved and the duplicate pre-check answered, so a 404 on
    // the POST itself is almost always Confluence masking a missing
    // create-permission (verified live 2026-07-19), not a bad id.
    if (error instanceof AxiError && error.code === "NOT_FOUND") {
      throw new AxiError(
        `Create failed in space ${space} — Confluence masks a missing page-create permission as 404`,
        "FORBIDDEN",
        [
          "Ask a space admin for create permission in this space",
          "Run `atlassian-axi confluence space list` to pick another space",
        ],
      );
    }
    throw error;
  }

  const id = created?.id;
  if (id === undefined || id === null) {
    // Shape drifted; still report success with a pointer to search.
    return renderOutput([
      renderDetail(
        "page",
        { _message: "Created (id not detected in the response)" },
        [field("_message", "message")],
      ),
      renderHelp([
        `Run \`atlassian-axi confluence search "title = \\"${title}\\""\` to find it`,
      ]),
    ]);
  }

  const page = await fetchPage(String(id), "storage");
  return renderPage(page, { ctx, action: "create" });
}

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

async function updatePage(args: string[], ctx?: SiteContext): Promise<string> {
  // valueBoundaryFlags keeps `--body --title "New"` from writing the literal
  // string "--title" as the page body and dropping the title change.
  const body = takeBody(args, {
    label: "page body",
    valueBoundaryFlags: ["--title"],
  });
  const parsed = parseFlags(args, {
    values: ["--title"],
    bools: ["--allow-macro-loss"],
  });
  if (parsed.help) return PAGE_HELP;

  const id = requirePageId(args, parsed.positional, "update");
  const title = parsed.values["--title"];

  if (title === undefined && body === undefined) {
    throw new AxiError("No changes specified", "VALIDATION_ERROR", [
      "Pass --title and/or --body/--body-file",
    ]);
  }

  // Read-before-write: the current version drives the mandatory bump, and an
  // update that changes nothing is a no-op success (idempotent contract).
  const current = await fetchPage(id, "storage");
  const currentVersion = versionOf(current);
  if (currentVersion === null) {
    throw new AxiError(
      `Could not read the current version of page ${id}`,
      "UNKNOWN",
    );
  }

  // Strict body read for the WRITE path: a shape-drifted (missing) body must
  // never be carried into the PUT as "", which would wipe the page content.
  const currentBody = strictBodyValueOf(current, "storage");
  if (body === undefined && currentBody === null) {
    throw new AxiError(
      `Could not read the current body of page ${id} — refusing to overwrite it`,
      "UNKNOWN",
      ["Pass --body/--body-file explicitly to set the page body"],
    );
  }

  const nextTitle = title ?? (current.title as string);
  const nextBody = body ?? (currentBody as string);

  // A storage-format update is a FULL-body replace, so a new --body that omits
  // a macro/embed present in the current page silently deletes it — this is
  // how an embedded whiteboard/diagram "disappears" on an innocent text edit.
  // Refuse by default; require an explicit opt-in to drop it. Only relevant
  // when the caller supplied a new body (title-only edits keep the body).
  if (body !== undefined && !parsed.bools["--allow-macro-loss"]) {
    const dropped = droppedMacros(currentBody, nextBody);
    if (dropped.length > 0) {
      throw new AxiError(
        `This update would remove ${dropped.length} embedded macro${dropped.length > 1 ? "s" : ""} (${dropped.join(", ")}) — e.g. a whiteboard/diagram would disappear`,
        "VALIDATION_ERROR",
        [
          `Read the current body first (\`atlassian-axi confluence page get ${id} --full\`), keep the \`<ac:structured-macro …>\` block(s) in your new body, and re-run`,
          "Or pass --allow-macro-loss to intentionally drop them",
        ],
      );
    }
  }

  const unchanged = nextTitle === current.title && nextBody === currentBody;
  if (unchanged) {
    return renderPage(current, {
      message: "Already up to date",
      ctx,
      action: "update",
    });
  }

  await confluenceJson<JsonRecord>(`/wiki/api/v2/pages/${id}`, {
    method: "PUT",
    body: {
      id,
      status: current.status ?? "current",
      title: nextTitle,
      body: { representation: "storage", value: nextBody },
      version: { number: currentVersion + 1 },
    },
  });

  const page = await fetchPage(id, "storage");
  return renderPage(page, { ctx, action: "update" });
}

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

async function deletePage(args: string[], ctx?: SiteContext): Promise<string> {
  const parsed = parseFlags(args, {});
  if (parsed.help) return PAGE_HELP;

  const id = requirePageId(args, parsed.positional, "delete");

  // Idempotent: deleting a page that is already gone is a no-op success.
  // "Gone" includes trashed — v2 GET answers a trashed page with 200 +
  // status "trashed", and a DELETE on it 404s (verified live 2026-07-19).
  let current: JsonRecord;
  try {
    current = await fetchPage(id, "storage");
  } catch (error) {
    if (error instanceof AxiError && error.code === "NOT_FOUND") {
      return renderOutput([
        renderDetail("page", { id, _message: "Already deleted" }, [
          field("id"),
          field("_message", "message"),
        ]),
        renderHelp(
          getSuggestions({ domain: "page", action: "delete", id, site: ctx }),
        ),
      ]);
    }
    throw error;
  }
  if (current.status === "trashed") {
    return renderOutput([
      renderDetail(
        "page",
        { id, title: current.title ?? null, _message: "Already deleted (in trash)" },
        [field("id"), field("title"), field("_message", "message")],
      ),
      renderHelp(
        getSuggestions({ domain: "page", action: "delete", id, site: ctx }),
      ),
    ]);
  }

  // A 404 on the DELETE itself is ambiguous: the page may have vanished
  // between the pre-read and the delete (no-op success), but Confluence also
  // masks missing delete-permission as 404 (verified live 2026-07-19). The
  // pre-read just succeeded, so re-check: if the page is still readable the
  // delete did NOT happen and claiming "Already deleted" would be a false
  // success.
  let message = "Deleted";
  try {
    await confluenceJson<undefined>(`/wiki/api/v2/pages/${id}`, {
      method: "DELETE",
    });
  } catch (error) {
    if (!(error instanceof AxiError) || error.code !== "NOT_FOUND") {
      throw error;
    }
    const stillExists = await pageStillExists(id);
    if (stillExists) {
      throw new AxiError(
        `Delete failed: page ${id} still exists — Confluence masks a missing delete permission as 404`,
        "FORBIDDEN",
        [
          "Ask a space admin for delete permission in this space",
          "Run `atlassian-axi auth status` to verify the credential",
        ],
      );
    }
    message = "Already deleted";
  }

  return renderOutput([
    renderDetail(
      "page",
      { id, title: current.title ?? null, _message: message },
      [field("id"), field("title"), field("_message", "message")],
    ),
    renderHelp(
      getSuggestions({ domain: "page", action: "delete", id, site: ctx }),
    ),
  ]);
}
