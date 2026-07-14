import { custom, extract, relativeTime, type FieldDef } from "../../toon.js";
import { truncateBody } from "../../body.js";

/**
 * Shared tolerant accessors + FieldDef schemas for the acli-backed Jira half.
 *
 * acli's --json shape is an external, undocumented contract (scout report risk
 * R3): payloads mirror the Jira Cloud REST v3 issue shape (`key` at top level,
 * everything else under `fields`), but every accessor here also tolerates a
 * flattened shape so a drift in acli output degrades to nulls instead of
 * crashes. Fixtures in test/fixtures/acli.ts pin the expected shape.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- payloads are JSON-parsed with dynamic keys
export type JsonRecord = Record<string, any>;

/** Read a Jira field: nested `item.fields[name]` first, then flat `item[name]`. */
export function fieldOf(item: JsonRecord, name: string): unknown {
  const fields = item?.fields;
  const nested =
    fields && typeof fields === "object"
      ? (fields as JsonRecord)[name]
      : undefined;
  return nested ?? item?.[name];
}

/** Collapse Jira's named-object values ({name}/{displayName}/{key}) to a string. */
export function nameOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    const record = value as JsonRecord;
    const name = record.name ?? record.displayName ?? record.key;
    return typeof name === "string" ? name : null;
  }
  return typeof value === "string" ? value : String(value);
}

/**
 * Flatten an Atlassian Document Format (ADF) document to plain text. Jira
 * descriptions/comments arrive as ADF objects from the REST shape; plain-text
 * strings pass through untouched.
 */
export function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const parts: string[] = [];
  walkAdf(value as JsonRecord, parts);
  return parts.join("");
}

function walkAdf(node: JsonRecord, parts: string[]): void {
  if (typeof node.text === "string") {
    parts.push(node.text);
  }
  const content = node.content;
  if (Array.isArray(content)) {
    for (const child of content) {
      if (child && typeof child === "object") {
        walkAdf(child as JsonRecord, parts);
      }
    }
    if (node.type === "paragraph" || node.type === "heading") {
      parts.push("\n");
    }
  }
}

/** Short status enum keeps list output token-lean; unknown statuses lowercase. */
export function shortStatus(item: JsonRecord): string {
  const name = nameOf(fieldOf(item, "status"));
  if (!name) return "unknown";
  const map: Record<string, string> = {
    "to do": "todo",
    "in progress": "wip",
    "in review": "review",
    done: "done",
    backlog: "backlog",
    "selected for development": "selected",
  };
  return map[name.toLowerCase()] ?? name.toLowerCase();
}

function assigneeOf(item: JsonRecord): string {
  return nameOf(fieldOf(item, "assignee")) ?? "unassigned";
}

/** List schema: key, summary, short status, assignee, relative updated. */
export const workitemListSchema: FieldDef[] = [
  custom("key", (item: JsonRecord) => item.key ?? null),
  custom("summary", (item: JsonRecord) => nameOf(fieldOf(item, "summary"))),
  custom("status", shortStatus),
  custom("assignee", assigneeOf),
  custom("updated", (item: JsonRecord) => relativeOf(item, "updated")),
];

/** Compact schema for the home dashboard's my-open-workitems block. */
export const workitemDashboardSchema: FieldDef[] = [
  custom("key", (item: JsonRecord) => item.key ?? null),
  custom("summary", (item: JsonRecord) => nameOf(fieldOf(item, "summary"))),
  custom("status", shortStatus),
];

/** Detail schema for `view`; body truncated unless --full. */
export function workitemViewSchema(full: boolean): FieldDef[] {
  return [
    custom("key", (item: JsonRecord) => item.key ?? null),
    custom("summary", (item: JsonRecord) => nameOf(fieldOf(item, "summary"))),
    custom("type", (item: JsonRecord) => nameOf(fieldOf(item, "issuetype"))),
    custom("status", (item: JsonRecord) =>
      nameOf(fieldOf(item, "status"))?.toLowerCase() ?? "unknown",
    ),
    custom("assignee", assigneeOf),
    custom("priority", (item: JsonRecord) =>
      nameOf(fieldOf(item, "priority")),
    ),
    custom("created", (item: JsonRecord) =>
      relativeOf(item, "created"),
    ),
    custom("updated", (item: JsonRecord) =>
      relativeOf(item, "updated"),
    ),
    custom("body", (item: JsonRecord) => {
      const text = textOf(fieldOf(item, "description")).trim();
      return full ? text : truncateBody(text, 500);
    }),
  ];
}

/** Comment schema: author, relative created, truncated body. */
export const commentSchema: FieldDef[] = [
  custom("author", (item: JsonRecord) => nameOf(item.author) ?? "unknown"),
  custom("created", (item: JsonRecord) => relativeOf(item, "created")),
  custom("body", (item: JsonRecord) =>
    truncateBody(textOf(item.body).trim(), 300, {
      fullHint: "use `view <KEY> --full --comments` for complete bodies",
    }),
  ),
];

/** Render a nested Jira timestamp via the shared relativeTime formatter. */
function relativeOf(item: JsonRecord, name: string): string {
  const raw = fieldOf(item, name);
  const lifted = { [name]: typeof raw === "string" ? raw : null };
  const out = extract(lifted, [relativeTime(name)]);
  return String(out[name] ?? "unknown");
}

/**
 * Normalize acli list-shaped payloads: bare arrays pass through; object
 * envelopes are probed for the usual Jira REST collection keys.
 */
export function itemsOf(payload: unknown, ...keys: string[]): JsonRecord[] {
  if (Array.isArray(payload)) return payload as JsonRecord[];
  if (payload && typeof payload === "object") {
    for (const key of keys) {
      const value = (payload as JsonRecord)[key];
      if (Array.isArray(value)) return value as JsonRecord[];
    }
  }
  return [];
}

/**
 * Build a dynamic schema from a user-supplied --fields list. `key` is always
 * included; values resolve tolerantly and named objects collapse to names.
 */
export function fieldsSchema(fields: string[]): FieldDef[] {
  const names = ["key", ...fields.filter((f) => f !== "key")];
  return names.map((name) =>
    name === "key"
      ? custom("key", (item: JsonRecord) => item.key ?? null)
      : custom(name, (item: JsonRecord) => {
          const value = fieldOf(item, name);
          if (name === "updated" || name === "created") {
            return relativeOf(item, name);
          }
          if (value && typeof value === "object" && !Array.isArray(value)) {
            return nameOf(value);
          }
          return value ?? null;
        }),
  );
}
