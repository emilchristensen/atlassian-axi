import { custom, extract, relativeTime, type FieldDef } from "@atlassian-axi/core";
import { truncateBody } from "@atlassian-axi/core";
import { AxiError } from "@atlassian-axi/core";

// Domain-agnostic plumbing lives in commands/shared.ts (also used by the
// Confluence half); re-exported so jira modules keep one import site.
export {
  parseFlags,
  parseLimit,
  // The --fields split is domain-agnostic and now lives in core so both CLIs
  // parse the escape hatch identically; re-exported for the existing call sites.
  splitFields,
  type ParsedFlags,
} from "@atlassian-axi/core";

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
    // Every block-level node ends its own line; without codeBlock/listItem
    // here a fenced block ran straight into the next paragraph
    // ("const x = 42;Link to Atlassian" — sweep finding 2026-07-19).
    // Dedupe at push time (listItem wraps paragraph, both terminate) — a
    // global \n{2,} collapse would also destroy literal blank lines inside
    // codeBlock text (review finding 2026-07-19).
    if (
      node.type === "paragraph" ||
      node.type === "heading" ||
      node.type === "codeBlock" ||
      node.type === "listItem"
    ) {
      const last = parts[parts.length - 1];
      if (last === undefined || !last.endsWith("\n")) {
        parts.push("\n");
      }
    }
  }
}

/**
 * Baseline truncation length for every free-text field in this CLI (workitem
 * body, comment body, filter/project description). One constant so the
 * truncation stays uniform, per the AXI 500-1500 floor.
 */
export const BODY_TRUNCATE_LENGTH = 500;

interface TruncatedTextFieldOptions {
  /** Command-specific escape hatch named in the truncation marker. */
  fullHint?: string;
  /** Placeholder for a blank field, where the call site renders one. */
  emptyValue?: string;
}

/**
 * Build the one truncated free-text FieldDef every body/description column
 * uses. Truncation is engine-owned (`truncateBody`); call sites supply only
 * how to read their text and how their own --full flag is spelled.
 */
export function truncatedTextField(
  name: string,
  getText: (item: JsonRecord) => string,
  full: boolean,
  options: TruncatedTextFieldOptions = {},
): FieldDef {
  return custom(name, (item: JsonRecord) => {
    const text = getText(item);
    if (!text && options.emptyValue !== undefined) return options.emptyValue;
    if (full) return text;
    return truncateBody(
      text,
      BODY_TRUNCATE_LENGTH,
      options.fullHint !== undefined ? { fullHint: options.fullHint } : {},
    );
  });
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
    truncatedTextField(
      "body",
      (item: JsonRecord) => textOf(fieldOf(item, "description")).trim(),
      full,
    ),
  ];
}

/**
 * Comment schema: author, body (truncated at the same 500-char baseline as
 * the workitem description unless --full). No `created` column:
 * acli's comment list --json carries only {id, author, body, visibility}
 * (verified live against v1.3.22); author arrives as a plain string.
 */
export function commentSchema(full: boolean): FieldDef[] {
  return [
    custom("author", (item: JsonRecord) => nameOf(item.author) ?? "unknown"),
    truncatedTextField(
      "body",
      (item: JsonRecord) => textOf(item.body).trim(),
      full,
      { fullHint: "use `view <KEY> --full --comments` for complete bodies" },
    ),
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

/** Probe an acli collection envelope for its server-side total count. */
export function totalOf(payload: unknown): number | undefined {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const total = (payload as JsonRecord).total;
    if (typeof total === "number") return total;
  }
  return undefined;
}

/**
 * Require a numeric ID positional/flag value (boards, sprints, and filters
 * are ID-addressed, unlike key-addressed work items/projects). Rejecting
 * non-digits up front turns a swapped positional into a clear error instead
 * of a confusing acli failure.
 */
export function requireNumericId(
  raw: string | undefined,
  usage: string,
  label = "ID",
): string {
  if (!raw) {
    throw new AxiError(`Missing ${label}`, "VALIDATION_ERROR", [usage]);
  }
  if (!/^\d+$/.test(raw)) {
    throw new AxiError(
      `Invalid ${label}: ${raw} (expected a number)`,
      "VALIDATION_ERROR",
      [usage],
    );
  }
  return raw;
}

/**
 * Render an ISO timestamp as YYYY-MM-DD. Sprint dates are often in the
 * future, where relativeTime's "just now"/"ago" phrasing misleads. The date
 * is taken verbatim from the timestamp's OWN offset (Jira sends timestamps
 * in the site/user zone) - converting through the local machine's timezone
 * or UTC could shift it a day relative to what the Jira UI shows.
 */
export function dateOnly(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})([T ]|$)/);
  if (match) return match[1];
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/**
 * Reject a silently-ignored SECOND positional. Every jira-axi subcommand takes
 * at most one positional (a key/id, or a quoted query). An unquoted multi-word
 * query - `workitem search project = TEAM` - would otherwise keep only the
 * first token and return wrong results at exit 0. Mirrors confluence-axi's
 * requirePageId guard and the filter-search guard.
 */
export function rejectExtraPositional(args: string[], hint: string): void {
  const extra = args.slice(1).filter((a) => !a.startsWith("--"))[1];
  if (extra !== undefined) {
    throw new AxiError(
      `Unexpected extra argument: ${extra}`,
      "VALIDATION_ERROR",
      [hint],
    );
  }
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
          // Match the detail view's status render (lowercased real name, not
          // the shortStatus enum): a --fields render is an explicit per-field
          // request, so give the JQL-usable value — "in progress", not "wip"
          // (review finding 2026-07-19; the original sweep bug was the raw
          // "Done" casing, which lowercasing already fixes).
          if (name === "status") {
            return nameOf(fieldOf(item, "status"))?.toLowerCase() ?? "unknown";
          }
          if (value && typeof value === "object" && !Array.isArray(value)) {
            return nameOf(value);
          }
          return value ?? null;
        }),
  );
}
