import { custom, extract, relativeTime, type FieldDef } from "../../toon.js";
import { takeBoolFlag, takeFlag } from "../../args.js";
import { truncateBody } from "../../body.js";
import { AxiError } from "../../errors.js";

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

/**
 * List schema: key, summary, short status, assignee. No `updated` column:
 * acli's search --fields whitelist rejects `updated` (verified live against
 * v1.3.22: "field 'updated' is not allowed"), so search payloads can never
 * carry it. `view` fetches it explicitly instead.
 */
export const workitemListSchema: FieldDef[] = [
  custom("key", (item: JsonRecord) => item.key ?? null),
  custom("summary", (item: JsonRecord) => nameOf(fieldOf(item, "summary"))),
  custom("status", shortStatus),
  custom("assignee", assigneeOf),
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

/**
 * Comment schema: author, body (truncated unless --full). No `created` column:
 * acli's comment list --json carries only {id, author, body, visibility}
 * (verified live against v1.3.22); author arrives as a plain string.
 */
export function commentSchema(full: boolean): FieldDef[] {
  return [
    custom("author", (item: JsonRecord) => nameOf(item.author) ?? "unknown"),
    custom("body", (item: JsonRecord) => {
      const text = textOf(item.body).trim();
      return full
        ? text
        : truncateBody(text, 300, {
            fullHint: "use `view <KEY> --full --comments` for complete bodies",
          });
    }),
  ];
}

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

export interface ParsedFlags {
  /** Value flags, keyed by flag name (e.g. "--limit"). */
  values: Record<string, string | undefined>;
  /** Boolean flags, keyed by flag name (e.g. "--full"). */
  bools: Record<string, boolean>;
  /** True when a standalone --help remained after flag consumption. */
  help: boolean;
  /** The first remaining positional (flags and their values already removed). */
  positional: string | undefined;
}

/**
 * Consume a subcommand's known flags from `args` (mutating it), THEN read the
 * first remaining positional. Consuming flag values first is what keeps
 * `transition --to Done TEAM-1` from parsing "Done" as the key, and keeps a
 * flag value that happens to be "--help" from hijacking the subcommand into
 * help output (body flags must be taken by the caller before calling this).
 */
export function parseFlags(
  args: string[],
  spec: { values?: string[]; bools?: string[] },
): ParsedFlags {
  const values: Record<string, string | undefined> = {};
  for (const flag of spec.values ?? []) {
    values[flag] = takeFlag(args, flag);
  }
  const bools: Record<string, boolean> = {};
  for (const flag of spec.bools ?? []) {
    bools[flag] = takeBoolFlag(args, flag);
  }
  const help = takeBoolFlag(args, "--help");
  const positional = args.slice(1).find((a) => !a.startsWith("--"));
  return { values, bools, help, positional };
}

const DEFAULT_LIMIT = 30;

/** Parse a --limit value; positive integer or a VALIDATION_ERROR. */
export function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n <= 0) {
    throw new AxiError(`Invalid --limit: ${raw}`, "VALIDATION_ERROR");
  }
  return n;
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
