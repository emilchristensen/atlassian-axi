import { custom, extract, relativeTime, type FieldDef } from "@atlassian-axi/core";
import { truncateBody } from "@atlassian-axi/core";
import { AxiError } from "../../errors.js";

/**
 * Tolerant accessors + FieldDef schemas for the direct-REST Confluence half.
 *
 * Shapes follow the Confluence Cloud REST contracts: v2 pages/spaces return
 * `{results: [...]}` envelopes with cursor `_links.next`; v1 CQL search
 * returns `{results: [...]}` where each hit nests the entity under `content`
 * and decorates title/excerpt with `@@@hl@@@` highlight markers. Every
 * accessor degrades to null on a missing field so an API drift never crashes
 * a command (mirrors the Jira half's risk-R3 stance). Fixtures in
 * test/fixtures/confluence.ts pin the expected shapes.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- payloads are JSON-parsed with dynamic keys
export type JsonRecord = Record<string, any>;

/** Unwrap a `{results: [...]}` collection envelope; bare arrays pass through. */
export function resultsOf(payload: unknown): JsonRecord[] {
  if (Array.isArray(payload)) return payload as JsonRecord[];
  if (payload && typeof payload === "object") {
    const results = (payload as JsonRecord).results;
    if (Array.isArray(results)) return results as JsonRecord[];
  }
  return [];
}

/** Whether a v2 collection has another cursor page (`_links.next`). */
export function hasNextPage(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const links = (payload as JsonRecord)._links;
  return Boolean(
    links && typeof links === "object" && (links as JsonRecord).next,
  );
}

/** Current page version number, or null when the shape drifted. */
export function versionOf(page: JsonRecord): number | null {
  const version = page?.version;
  const number =
    version && typeof version === "object"
      ? (version as JsonRecord).number
      : undefined;
  return typeof number === "number" ? number : null;
}

/** Body value for a representation (`storage`/`atlas_doc_format`), if present. */
export function bodyValueOf(page: JsonRecord, representation: string): string {
  return strictBodyValueOf(page, representation) ?? "";
}

/**
 * Body value distinguishing "missing" (null) from a genuinely empty body ("").
 * Read paths tolerate a missing body as ""; WRITE paths must not — carrying a
 * shape-drifted read into a PUT would wipe the page content (review finding).
 */
export function strictBodyValueOf(
  page: JsonRecord,
  representation: string,
): string | null {
  const body = page?.body;
  const rep =
    body && typeof body === "object"
      ? (body as JsonRecord)[representation]
      : undefined;
  const value =
    rep && typeof rep === "object" ? (rep as JsonRecord).value : undefined;
  return typeof value === "string" ? value : null;
}

/**
 * Strip v1 search highlight markers (`@@@hl@@@...@@@endhl@@@`) and clean the
 * excerpt artifacts v1 ships: undecoded HTML entities and lone surrogate
 * halves (excerpts are truncated mid-codepoint, leaving U+FFFD-rendering
 * garbage — verified live 2026-07-19).
 */
export function stripHighlights(text: unknown): string {
  if (typeof text !== "string") return "";
  return text
    .replace(/@@@(?:end)?hl@@@/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    // &amp; last, or "&amp;lt;" would double-decode into "<".
    .replace(/&amp;/g, "&")
    // Lone high/low surrogates (broken pairs from mid-codepoint truncation).
    // Both sides use zero-width assertions — a consuming group would skip
    // every second half in a run of consecutive lone surrogates.
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

/** Render a timestamp field via the shared relativeTime formatter. */
export function relativeOf(raw: unknown): string {
  const lifted = { at: typeof raw === "string" ? raw : null };
  const out = extract(lifted, [relativeTime("at")]);
  return String(out.at ?? "unknown");
}

/** Detail schema for `page get` and post-mutation renders. */
export function pageDetailSchema(
  full: boolean,
  representation: string,
): FieldDef[] {
  return [
    custom("id", (item: JsonRecord) => item.id ?? null),
    custom("title", (item: JsonRecord) => item.title ?? null),
    custom("status", (item: JsonRecord) => item.status ?? null),
    custom("spaceId", (item: JsonRecord) => item.spaceId ?? null),
    custom("parentId", (item: JsonRecord) => item.parentId ?? null),
    custom("version", versionOf),
    custom("updated", (item: JsonRecord) =>
      relativeOf((item.version as JsonRecord | undefined)?.createdAt),
    ),
    custom("body", (item: JsonRecord) => {
      const text = bodyValueOf(item, representation).trim();
      return full ? text : truncateBody(text, 800);
    }),
  ];
}

/** Space list schema: key first — space keys are what users type elsewhere. */
export const spaceListSchema: FieldDef[] = [
  custom("key", (item: JsonRecord) => item.key ?? null),
  custom("name", (item: JsonRecord) => item.name ?? null),
  custom("type", (item: JsonRecord) => item.type ?? "unknown"),
  custom("id", (item: JsonRecord) => item.id ?? null),
];

/**
 * CQL search hit schema. The entity lives under `content`; the raw top-level
 * `title` carries highlight markers, so prefer `content.title` and fall back
 * to the stripped decorated one.
 */
export const searchResultSchema: FieldDef[] = [
  // Space hits carry no `content` block (verified live: `{space: {key},
  // entityType: "space"}`), so fall back to the space KEY — the id a user
  // can actually address — and the result's entityType instead of leaking
  // literal `null`/`unknown` rows.
  custom(
    "id",
    (item: JsonRecord) => contentOf(item).id ?? spaceOf(item).key ?? null,
  ),
  custom(
    "type",
    (item: JsonRecord) =>
      contentOf(item).type ??
      (typeof item.entityType === "string" ? item.entityType : "unknown"),
  ),
  custom(
    "title",
    (item: JsonRecord) =>
      contentOf(item).title ?? stripHighlights(item.title) ?? null,
  ),
  custom("space", (item: JsonRecord) => {
    const container = item.resultGlobalContainer;
    const title =
      container && typeof container === "object"
        ? (container as JsonRecord).title
        : undefined;
    return typeof title === "string" ? title : null;
  }),
  custom("modified", (item: JsonRecord) => relativeOf(item.lastModified)),
  custom("excerpt", (item: JsonRecord) => {
    // `page get` only works for page results; hinting it on a blogpost/
    // attachment/comment hit would be a dead-end escape hatch.
    const hint =
      contentOf(item).type === "page"
        ? "use `confluence-axi page get <id> --full` for the full body"
        : "open the result in Confluence for the full content";
    return truncateBody(stripHighlights(item.excerpt).trim(), 200, {
      fullHint: hint,
      originalHint: hint,
    });
  }),
];

function contentOf(item: JsonRecord): JsonRecord {
  const content = item?.content;
  return content && typeof content === "object" ? (content as JsonRecord) : {};
}

function spaceOf(item: JsonRecord): JsonRecord {
  const space = item?.space;
  return space && typeof space === "object" ? (space as JsonRecord) : {};
}

/**
 * Require exactly one positional page id for a `page <sub>` subcommand.
 * Shared by page.ts and page-extras.ts (a silently ignored second positional
 * would act on a different page than the caller intended).
 */
export function requirePageId(
  args: string[],
  positional: string | undefined,
  sub: string,
): string {
  if (!positional) {
    throw new AxiError("Missing page id", "VALIDATION_ERROR", [
      `Run \`confluence-axi page ${sub} <id> ...\``,
      'Find page ids with `confluence-axi search "<CQL>"`',
    ]);
  }
  const extra = args.slice(1).filter((a) => !a.startsWith("--"))[1];
  if (extra !== undefined) {
    throw new AxiError(
      `Unexpected extra argument: ${extra}`,
      "VALIDATION_ERROR",
      [`Run \`confluence-axi page ${sub} <id>\` with a single id`],
    );
  }
  return positional;
}

/** Human-readable file size (attachments); integer bytes in, "12.3 KB" out. */
export function formatBytes(raw: unknown): string | null {
  if (typeof raw !== "number" || !isFinite(raw) || raw < 0) return null;
  if (raw < 1024) return `${raw} B`;
  const display = (value: number): number =>
    value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  const units = ["KB", "MB", "GB", "TB"];
  let value = raw;
  let unit = "B";
  for (const next of units) {
    value = value / 1024;
    unit = next;
    // Compare what would be DISPLAYED, not the raw value: 1048064 bytes is
    // 1023.5 KB, which rounds to the nonsense "1024 KB" — bump it to "1 MB".
    if (display(value) < 1024 || next === units[units.length - 1]) break;
  }
  return `${display(value)} ${unit}`;
}

/** List schema for `page attachments` (v2 AttachmentBulk shape). */
export const attachmentListSchema: FieldDef[] = [
  custom("id", (item: JsonRecord) => item.id ?? null),
  custom("title", (item: JsonRecord) => item.title ?? null),
  custom("mediaType", (item: JsonRecord) => item.mediaType ?? null),
  custom("size", (item: JsonRecord) => formatBytes(item.fileSize) ?? "unknown"),
  custom("version", versionOf),
  custom("updated", (item: JsonRecord) =>
    relativeOf((item.version as JsonRecord | undefined)?.createdAt),
  ),
];

/** List schema for `page labels` (v2 Label shape: id/name/prefix). */
export const labelListSchema: FieldDef[] = [
  custom("name", (item: JsonRecord) => item.name ?? null),
  custom("prefix", (item: JsonRecord) => item.prefix ?? null),
  custom("id", (item: JsonRecord) => item.id ?? null),
];

/** List schema for `page children` (v2 ChildPage shape). */
export const childPageListSchema: FieldDef[] = [
  custom("id", (item: JsonRecord) => item.id ?? null),
  custom("title", (item: JsonRecord) => item.title ?? null),
  custom("status", (item: JsonRecord) => item.status ?? null),
  custom("position", (item: JsonRecord) => item.childPosition ?? null),
];
