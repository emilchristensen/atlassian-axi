import { confluenceJson } from "../../confluence.js";
import type { SiteContext } from "../../context.js";
import { AxiError } from "../../errors.js";
import { formatCountLine } from "../../format.js";
import { getSuggestions } from "../../suggestions.js";
import { renderHelp, renderList, renderOutput } from "../../toon.js";
import { parseFlags, parseLimit } from "../shared.js";
import {
  attachmentListSchema,
  childPageListSchema,
  hasNextPage,
  labelListSchema,
  requirePageId,
  resultsOf,
  type JsonRecord,
} from "./shared.js";

/**
 * Page breadth subcommands (Phase 4b): attachments, labels, children.
 * Attachments/children and label LISTING are v2; label add/remove is v1
 * (`/wiki/rest/api/content/{id}/label`) because v2 has no label mutation
 * endpoints — the same v1-fallback pattern as CQL search.
 */

const LABEL_PREFIXES = ["my", "team", "global", "system"];

/** v2 max page size; used for the label idempotency pre-read. */
const LABEL_PREREAD_LIMIT = 250;

// ---------------------------------------------------------------------------
// attachments
// ---------------------------------------------------------------------------

export async function attachmentsPage(
  args: string[],
  help: string,
  ctx?: SiteContext,
): Promise<string> {
  const parsed = parseFlags(args, {
    values: ["--limit", "--media-type", "--filename"],
  });
  if (parsed.help) return help;

  const id = requirePageId(args, parsed.positional, "attachments");
  const limit = parseLimit(parsed.values["--limit"]);

  const payload = await confluenceJson<unknown>(
    `/wiki/api/v2/pages/${id}/attachments`,
    {
      query: {
        limit,
        mediaType: parsed.values["--media-type"],
        filename: parsed.values["--filename"],
      },
    },
  );
  const items = resultsOf(payload);

  const blocks: string[] = [
    formatCountLine({
      count: items.length,
      // v2 uses cursor pagination without a total; a next link means truncated.
      ...(hasNextPage(payload) ? { limit: items.length } : {}),
    }),
  ];
  if (items.length > 0) {
    blocks.push(renderList("attachments", items, attachmentListSchema));
  }
  blocks.push(
    renderHelp(
      getSuggestions({
        domain: "page",
        action: "attachments",
        id,
        isEmpty: items.length === 0,
        site: ctx,
      }),
    ),
  );
  return renderOutput(blocks);
}

// ---------------------------------------------------------------------------
// children
// ---------------------------------------------------------------------------

export async function childrenPage(
  args: string[],
  help: string,
  ctx?: SiteContext,
): Promise<string> {
  const parsed = parseFlags(args, { values: ["--limit"] });
  if (parsed.help) return help;

  const id = requirePageId(args, parsed.positional, "children");
  const limit = parseLimit(parsed.values["--limit"]);

  const payload = await confluenceJson<unknown>(
    `/wiki/api/v2/pages/${id}/children`,
    { query: { limit } },
  );
  const items = resultsOf(payload);

  const blocks: string[] = [
    formatCountLine({
      count: items.length,
      ...(hasNextPage(payload) ? { limit: items.length } : {}),
    }),
  ];
  if (items.length > 0) {
    blocks.push(renderList("children", items, childPageListSchema));
  }
  blocks.push(
    renderHelp(
      getSuggestions({
        domain: "page",
        action: "children",
        id,
        isEmpty: items.length === 0,
        site: ctx,
      }),
    ),
  );
  return renderOutput(blocks);
}

// ---------------------------------------------------------------------------
// labels
// ---------------------------------------------------------------------------

export async function labelsPage(
  args: string[],
  help: string,
  ctx?: SiteContext,
): Promise<string> {
  const parsed = parseFlags(args, {
    values: ["--add", "--remove", "--prefix", "--limit"],
  });
  if (parsed.help) return help;

  const id = requirePageId(args, parsed.positional, "labels");
  const add = parsed.values["--add"];
  const remove = parsed.values["--remove"];

  if (add !== undefined && remove !== undefined) {
    throw new AxiError(
      "--add and --remove cannot be combined",
      "VALIDATION_ERROR",
      ["Run add and remove as two separate `page labels` invocations"],
    );
  }
  if (add !== undefined || remove !== undefined) {
    // List-only flags are rejected in mutation mode instead of silently
    // dropped: the post-mutation render always shows the full label set.
    for (const flag of ["--prefix", "--limit"] as const) {
      if (parsed.values[flag] !== undefined) {
        throw new AxiError(
          `${flag} only applies when listing labels`,
          "VALIDATION_ERROR",
          [`Drop ${flag}, or run \`page labels ${id}\` to list with it`],
        );
      }
    }
  }

  if (add !== undefined) {
    return addLabels(id, splitLabelNames(add, "--add"), ctx);
  }
  if (remove !== undefined) {
    return removeLabels(id, splitLabelNames(remove, "--remove"), ctx);
  }
  return listLabels(id, parsed, ctx);
}

/** Comma-split label names; empty input or empty entries are loud errors. */
function splitLabelNames(raw: string, flag: string): string[] {
  const names = raw.split(",").map((n) => n.trim());
  if (names.length === 0 || names.some((n) => n === "")) {
    throw new AxiError(
      `Invalid ${flag} value: ${JSON.stringify(raw)}`,
      "VALIDATION_ERROR",
      [`Pass ${flag} <name> or ${flag} <name,name,...> (no empty names)`],
    );
  }
  return [...new Set(names)];
}

async function fetchLabels(
  id: string,
  query: Record<string, string | number | undefined>,
): Promise<{ items: JsonRecord[]; truncated: boolean }> {
  const payload = await confluenceJson<unknown>(
    `/wiki/api/v2/pages/${id}/labels`,
    { query },
  );
  return { items: resultsOf(payload), truncated: hasNextPage(payload) };
}

async function listLabels(
  id: string,
  parsed: { values: Record<string, string | undefined> },
  ctx?: SiteContext,
): Promise<string> {
  const limit = parseLimit(parsed.values["--limit"]);
  const prefix = parsed.values["--prefix"];
  if (prefix !== undefined && !LABEL_PREFIXES.includes(prefix)) {
    throw new AxiError(`Invalid --prefix: ${prefix}`, "VALIDATION_ERROR", [
      `Use one of: ${LABEL_PREFIXES.join(", ")}`,
    ]);
  }

  const { items, truncated } = await fetchLabels(id, { limit, prefix });
  return renderLabels(id, items, truncated, { action: "labels", ctx });
}

function renderLabels(
  id: string,
  items: JsonRecord[],
  truncated: boolean,
  options: { action: string; message?: string; ctx?: SiteContext },
): string {
  const blocks: string[] = [
    formatCountLine({
      count: items.length,
      ...(truncated ? { limit: items.length } : {}),
    }),
  ];
  if (options.message) {
    blocks.push(`message: ${options.message}`);
  }
  if (items.length > 0) {
    blocks.push(renderList("labels", items, labelListSchema));
  }
  blocks.push(
    renderHelp(
      getSuggestions({
        domain: "page",
        action: options.action,
        id,
        isEmpty: items.length === 0,
        site: options.ctx,
      }),
    ),
  );
  return renderOutput(blocks);
}

/** Current label names (idempotency pre-read; best-effort beyond 250). */
async function currentLabelNames(id: string): Promise<Set<string>> {
  const { items } = await fetchLabels(id, { limit: LABEL_PREREAD_LIMIT });
  return new Set(
    items
      .map((item) => item.name)
      .filter((name): name is string => typeof name === "string"),
  );
}

async function addLabels(
  id: string,
  names: string[],
  ctx?: SiteContext,
): Promise<string> {
  // Idempotent: read first, add only what is missing, report what was
  // already there, then re-fetch and render the authoritative label set.
  const existing = await currentLabelNames(id);
  const missing = names.filter((name) => !existing.has(name));
  const present = names.filter((name) => existing.has(name));

  if (missing.length > 0) {
    // v1 endpoint: v2 has no label mutations. Body is a bare LabelCreate
    // array; the response is ignored — the re-fetch below is authoritative.
    await confluenceJson<unknown>(`/wiki/rest/api/content/${id}/label`, {
      method: "POST",
      body: missing.map((name) => ({ prefix: "global", name })),
    });
  }

  const messages = [
    missing.length > 0 ? `Added: ${missing.join(", ")}` : null,
    present.length > 0 ? `Already present: ${present.join(", ")}` : null,
  ].filter(Boolean);
  const { items, truncated } = await fetchLabels(id, {
    limit: LABEL_PREREAD_LIMIT,
  });
  return renderLabels(id, items, truncated, {
    action: "labels-add",
    message: messages.join("; "),
    ctx,
  });
}

async function removeLabels(
  id: string,
  names: string[],
  ctx?: SiteContext,
): Promise<string> {
  // Idempotent: remove only what is present; a 404 on the DELETE itself
  // (label vanished between the pre-read and the delete) is also a no-op.
  const existing = await currentLabelNames(id);
  const present = names.filter((name) => existing.has(name));
  const absent = names.filter((name) => !existing.has(name));

  const removed: string[] = [];
  for (const name of present) {
    try {
      // v1 query-param variant (the path variant breaks on names with "/").
      await confluenceJson<undefined>(`/wiki/rest/api/content/${id}/label`, {
        method: "DELETE",
        query: { name },
      });
      removed.push(name);
    } catch (error) {
      if (error instanceof AxiError && error.code === "NOT_FOUND") {
        absent.push(name);
      } else {
        throw error;
      }
    }
  }

  const messages = [
    removed.length > 0 ? `Removed: ${removed.join(", ")}` : null,
    absent.length > 0 ? `Already absent: ${absent.join(", ")}` : null,
  ].filter(Boolean);
  const { items, truncated } = await fetchLabels(id, {
    limit: LABEL_PREREAD_LIMIT,
  });
  return renderLabels(id, items, truncated, {
    action: "labels-remove",
    message: messages.join("; "),
    ctx,
  });
}
