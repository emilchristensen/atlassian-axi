import { takeBody } from "@atlassian-axi/core";
import { confluenceJson } from "../../confluence.js";
import type { SiteContext } from "@atlassian-axi/core";
import { AxiError } from "../../errors.js";
import { getSuggestions } from "../../suggestions.js";
import {
  field,
  renderDetail,
  renderHelp,
  renderOutput,
} from "@atlassian-axi/core";
import { parseFlags, unknownSubcommandError } from "@atlassian-axi/core";
import { attachmentsPage, childrenPage, labelsPage } from "./page-extras.js";
import {
  pageDetailSchema,
  requirePageId,
  resultsOf,
  strictBodyValueOf,
  versionOf,
  type JsonRecord,
} from "./shared.js";

/**
 * Per-subcommand help content. Single source of truth for both the
 * whole-resource `page --help` doc and the subcommand-scoped `page <sub>
 * --help` doc, so the two can never drift apart.
 */
type PageSubcommandDoc = {
  /** Argument shape as it appears after `confluence-axi page`. */
  readonly usage: string;
  readonly summary: string;
  /** One entry per flag; rendered comma-joined on a single line. */
  readonly flags: readonly string[];
  readonly examples: readonly string[];
};

const PAGE_SUBCOMMAND_DOCS = {
  get: {
    usage: "get <id>",
    summary: "Read one page by id, body included.",
    flags: [
      "--full (complete body without truncation)",
      "--format <storage|adf> (default storage)",
    ],
    examples: ["confluence-axi page get 12345"],
  },
  create: {
    usage: "create",
    summary: "Create a page in a space (idempotent on space + title).",
    flags: [
      "--space <KEY> (required)",
      "--title <text> (required)",
      "--body <text> or --body-file <path> (storage format; required)",
      "--parent <id>",
    ],
    examples: [
      'confluence-axi page create --space ENG --title "Release notes" --body-file notes.html',
    ],
  },
  update: {
    usage: "update <id>",
    summary: "Replace a page title and/or body (full-body replace).",
    flags: [
      "--title <text>",
      "--body <text> or --body-file <path> (storage format; at least one required; version bump is automatic)",
      "--allow-macro-loss (permit dropping an embedded macro/whiteboard the current body still has; blocked by default)",
    ],
    examples: ['confluence-axi page update 12345 --body "<p>Updated</p>"'],
  },
  delete: {
    usage: "delete <id>",
    summary: "Delete a page (idempotent; already-trashed counts as deleted).",
    flags: [],
    examples: ["confluence-axi page delete 12345"],
  },
  attachments: {
    usage: "attachments <id>",
    summary: "List a page's attachments (read-only).",
    flags: [
      "--limit <n> (default 30)",
      "--media-type <type>",
      "--filename <name>",
    ],
    examples: ["confluence-axi page attachments 12345"],
  },
  labels: {
    usage: "labels <id>",
    summary: "List, add, or remove a page's labels.",
    flags: [
      "(no flags = list) --add <name,name,...> or --remove <name,name,...> (idempotent; exclusive; mutations manage GLOBAL-prefix labels only)",
      "--prefix <my|team|global|system> (list only)",
      "--limit <n> (list only, default 30)",
    ],
    examples: ["confluence-axi page labels 12345 --add release,july"],
  },
  children: {
    usage: "children <id>",
    summary: "List a page's direct child pages.",
    flags: ["--limit <n> (default 30)"],
    examples: ["confluence-axi page children 12345"],
  },
} as const satisfies Record<string, PageSubcommandDoc>;

export type PageSubcommand = keyof typeof PAGE_SUBCOMMAND_DOCS;

const PAGE_SUBCOMMANDS = Object.keys(PAGE_SUBCOMMAND_DOCS) as PageSubcommand[];

/** `flags[n]:` block, or nothing at all when the subcommand takes no flags. */
function flagsBlock(flags: readonly string[], label: string): string[] {
  if (flags.length === 0) return [];
  return [`flags${label}[${flags.length}]:`, `  ${flags.join(", ")}`];
}

function buildPageHelp(): string {
  const lines = [
    "usage: confluence-axi page <subcommand> [flags]",
    `subcommands[${PAGE_SUBCOMMANDS.length}]:`,
    `  ${PAGE_SUBCOMMANDS.map((name) => PAGE_SUBCOMMAND_DOCS[name].usage).join(", ")}`,
  ];
  for (const name of PAGE_SUBCOMMANDS) {
    lines.push(...flagsBlock(PAGE_SUBCOMMAND_DOCS[name].flags, `{${name}}`));
  }
  lines.push("examples:");
  for (const name of PAGE_SUBCOMMANDS) {
    for (const example of PAGE_SUBCOMMAND_DOCS[name].examples) {
      lines.push(`  ${example}`);
    }
  }
  return lines.join("\n");
}

/** Whole-resource help, served for bare `confluence-axi page --help`. */
export const PAGE_HELP = buildPageHelp();

/**
 * Help for one subcommand, served for `confluence-axi page <sub> --help`.
 * Falls back to the whole-resource doc for an unknown or absent subcommand so
 * a caller never gets an empty reference.
 */
export function pageHelp(sub?: string): string {
  const doc = sub === undefined ? undefined : lookupDoc(sub);
  if (!doc) return PAGE_HELP;
  return [
    `usage: confluence-axi page ${doc.usage}${doc.flags.length > 0 ? " [flags]" : ""}`,
    doc.summary,
    ...flagsBlock(doc.flags, ""),
    "examples:",
    ...doc.examples.map((example) => `  ${example}`),
    "help[1]:",
    `  Run \`confluence-axi page --help\` for all ${PAGE_SUBCOMMANDS.length} page subcommands`,
  ].join("\n");
}

function lookupDoc(sub: string): PageSubcommandDoc | undefined {
  return Object.prototype.hasOwnProperty.call(PAGE_SUBCOMMAND_DOCS, sub)
    ? PAGE_SUBCOMMAND_DOCS[sub as PageSubcommand]
    : undefined;
}

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
      return attachmentsPage(args, pageHelp("attachments"), ctx);
    case "labels":
      return labelsPage(args, pageHelp("labels"), ctx);
    case "children":
      return childrenPage(args, pageHelp("children"), ctx);
    default:
      throw unknownSubcommandError(
        "page subcommand",
        sub,
        [...PAGE_SUBCOMMANDS],
        "confluence-axi page --help",
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
    // Strip CDATA sections and XML comments first: a macro-name literal inside
    // a code macro's `<![CDATA[...]]>` sample (or a comment) must not count as
    // a real macro in `next`, or a genuinely dropped macro would slip the guard
    // and be silently deleted. Accept both quote styles — Confluence honours
    // single-quoted `ac:name='toc'`, which a double-quote-only match would
    // falsely report as dropped and block a valid update.
    const clean = xhtml
      .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
      .replace(/<!--[\s\S]*?-->/g, "");
    const out: string[] = [];
    const re =
      /<ac:structured-macro\b[^>]*\bac:name=(?:"([^"]*)"|'([^']*)')/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(clean)) !== null) out.push(m[1] ?? m[2] ?? "");
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
 * live 2026-07-19), so status decides — any readable NON-trashed page (current,
 * archived, draft) still exists, so a permission-masked DELETE 404 on it must
 * surface as FORBIDDEN, not a false "Already deleted". Only a clean NOT_FOUND
 * or a trashed status counts as gone. Any other failure rethrows so a network
 * blip is never mistaken for a successful delete.
 */
async function pageStillExists(id: string): Promise<boolean> {
  try {
    const page = await fetchPage(id, "storage");
    return page.status !== "trashed";
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
  // A real space key is a single token. The v2 `keys` filter is a
  // comma-separated LIST, so a value like "ENG,DOCS" would match both spaces
  // and `limit:1` would create the page in whichever the server sorts first —
  // silently the wrong space. Reject commas/whitespace loudly instead.
  if (/[,\s]/.test(key)) {
    throw new AxiError(
      `Invalid space key: ${JSON.stringify(key)}`,
      "VALIDATION_ERROR",
      [
        "A space key is a single token (no commas or spaces), e.g. ENG",
        "Run `confluence-axi space list` to see space keys",
      ],
    );
  }
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
    "Run `confluence-axi space list` to see available space keys",
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
  if (parsed.help) return pageHelp("get");

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
  if (parsed.help) return pageHelp("create");

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
        'Run `confluence-axi page create --space <KEY> --title "..." --body-file <path>`',
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
          "Run `confluence-axi space list` to pick another space",
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
      // Route through getSuggestions like every other path, or this follow-up
      // silently drops an explicit --site and searches the wrong site.
      renderHelp(
        getSuggestions({
          domain: "page",
          action: "create",
          state: "no-id",
          id: title as string,
          site: ctx,
        }),
      ),
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
  if (parsed.help) return pageHelp("update");

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
          `Read the current body first (\`confluence-axi page get ${id} --full\`), keep the \`<ac:structured-macro …>\` block(s) in your new body, and re-run`,
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
  if (parsed.help) return pageHelp("delete");

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
          "Run `confluence-axi auth status` to verify the credential",
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
