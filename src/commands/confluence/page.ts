import { takeBody } from "../../body.js";
import { confluenceJson } from "../../confluence.js";
import type { SiteContext } from "../../context.js";
import { AxiError } from "../../errors.js";
import { getSuggestions } from "../../suggestions.js";
import {
  field,
  renderDetail,
  renderError,
  renderHelp,
  renderOutput,
} from "../../toon.js";
import { parseFlags } from "../shared.js";
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
  --title <text>, --body <text> or --body-file <path> (storage format; at least one required; version bump is automatic)
flags{attachments}:
  --limit <n> (default 30), --media-type <type>, --filename <name>
flags{labels}:
  (no flags = list) --add <name,name,...> or --remove <name,name,...> (idempotent; exclusive), --prefix <my|team|global|system> (list only), --limit <n> (list only, default 30)
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
      return renderError(
        `Unknown page subcommand: ${sub}`,
        "VALIDATION_ERROR",
        ["Run `atlassian-axi confluence page --help` for usage"],
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

  const created = await confluenceJson<JsonRecord>("/wiki/api/v2/pages", {
    method: "POST",
    body: {
      spaceId,
      status: "current",
      title,
      ...(parent ? { parentId: parent } : {}),
      body: { representation: "storage", value: body },
    },
  });

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
  const parsed = parseFlags(args, { values: ["--title"] });
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

  // A 404 on the DELETE itself (the page vanished between the pre-read and
  // the delete) is the same no-op success as the pre-read miss above.
  let message = "Deleted";
  try {
    await confluenceJson<undefined>(`/wiki/api/v2/pages/${id}`, {
      method: "DELETE",
    });
  } catch (error) {
    if (error instanceof AxiError && error.code === "NOT_FOUND") {
      message = "Already deleted";
    } else {
      throw error;
    }
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
