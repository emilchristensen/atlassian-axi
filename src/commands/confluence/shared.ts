import { custom, extract, relativeTime, type FieldDef } from "../../toon.js";
import { truncateBody } from "../../body.js";

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
  const body = page?.body;
  const rep =
    body && typeof body === "object"
      ? (body as JsonRecord)[representation]
      : undefined;
  const value =
    rep && typeof rep === "object" ? (rep as JsonRecord).value : undefined;
  return typeof value === "string" ? value : "";
}

/** Strip v1 search highlight markers (`@@@hl@@@...@@@endhl@@@`). */
export function stripHighlights(text: unknown): string {
  if (typeof text !== "string") return "";
  return text.replace(/@@@(?:end)?hl@@@/g, "");
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
  custom("id", (item: JsonRecord) => contentOf(item).id ?? null),
  custom("type", (item: JsonRecord) => contentOf(item).type ?? "unknown"),
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
  custom("excerpt", (item: JsonRecord) =>
    truncateBody(stripHighlights(item.excerpt).trim(), 200, {
      fullHint: "use `confluence page get <id> --full` for the full body",
      originalHint: "use `confluence page get <id> --full` for the full body",
    }),
  ),
];

function contentOf(item: JsonRecord): JsonRecord {
  const content = item?.content;
  return content && typeof content === "object" ? (content as JsonRecord) : {};
}
