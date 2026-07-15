import { acliJson } from "../../acli.js";
import { takeBody } from "../../body.js";
import type { SiteContext } from "../../context.js";
import { AxiError } from "../../errors.js";
import { formatCountLine } from "../../format.js";
import { getSuggestions } from "../../suggestions.js";
import {
  field,
  renderDetail,
  renderError,
  renderHelp,
  renderList,
  renderOutput,
} from "../../toon.js";
import {
  commentSchema,
  fieldsSchema,
  fieldOf,
  itemsOf,
  nameOf,
  parseFlags,
  parseLimit,
  workitemListSchema,
  workitemViewSchema,
  type JsonRecord,
} from "./shared.js";

export const WORKITEM_HELP = `usage: atlassian-axi jira workitem <subcommand> [flags]
subcommands[8]:
  list, view <KEY>, create, edit <KEY>, transition <KEY>, assign <KEY>, comment <KEY>, search "<JQL>"
flags{list}:
  --jql <query> (verbatim; exclusive with the filters below), --project <KEY>, --assignee <email|@me>, --status <name>, --limit <n> (default 30), --fields <a,b,c> (no filters => updated >= -30d window; acli rejects unbounded JQL)
flags{view}:
  --comments, --full (complete bodies without truncation), --fields <a,b,c> (render only these fields; key is always included)
flags{create}:
  --project <KEY> (required), --type <name> (required), --summary <text> (required), --body <text> or --body-file <path> (description), --assignee <email|@me>, --label <a,b>
flags{edit}:
  --summary <text>, --body <text> or --body-file <path> (description), --assignee <email|@me>, --type <name>, --labels <a,b>, --remove-labels <a,b>
flags{transition}:
  --to <status> (required; no-op success when already there)
flags{assign}:
  --assignee <email|@me> (required)
flags{comment}:
  --body <text> or --body-file <path> (required)
flags{search}:
  --limit <n> (default 30), --fields <a,b,c>
examples:
  atlassian-axi jira workitem list --project TEAM --status "In Progress"
  atlassian-axi jira workitem view TEAM-1 --comments
  atlassian-axi jira workitem create --project TEAM --type Task --summary "Fix login"
  atlassian-axi jira workitem transition TEAM-1 --to Done
  atlassian-axi jira workitem search "assignee = currentUser() AND resolution = EMPTY"`;

export async function workitemCommand(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const sub = args[0];

  if (!sub || sub === "--help") {
    return WORKITEM_HELP;
  }

  switch (sub) {
    case "list":
      return listWorkitems(args, ctx);
    case "view":
      return viewWorkitem(args, ctx);
    case "create":
      return createWorkitem(args, ctx);
    case "edit":
      return editWorkitem(args, ctx);
    case "transition":
      return transitionWorkitem(args, ctx);
    case "assign":
      return assignWorkitem(args, ctx);
    case "comment":
      return commentWorkitem(args, ctx);
    case "search":
      return searchWorkitems(args, ctx);
    default:
      return renderError(
        `Unknown workitem subcommand: ${sub}`,
        "VALIDATION_ERROR",
        ["Run `atlassian-axi jira workitem --help` for usage"],
      );
  }
}

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

function requireKey(positional: string | undefined, sub: string): string {
  if (!positional) {
    throw new AxiError(`Missing work item key`, "VALIDATION_ERROR", [
      `Run \`atlassian-axi jira workitem ${sub} <KEY> ...\``,
    ]);
  }
  return positional.toUpperCase();
}

function splitFields(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const fields = raw
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  return fields.length > 0 ? fields : undefined;
}

// acli view's default field set omits created/updated/priority; request the
// full detail set explicitly (verified allowed against acli v1.3.22).
const VIEW_FIELDS =
  "key,summary,status,assignee,description,created,updated,priority,issuetype";

/**
 * Fetch one work item by key (acli view --json; tolerate array envelopes).
 * A user --fields list replaces the default detail set (`key` always rides
 * along so the render can anchor on it).
 */
async function fetchWorkitem(
  key: string,
  fields?: string[],
): Promise<JsonRecord> {
  const requested = fields
    ? [...new Set(["key", ...fields])].join(",")
    : VIEW_FIELDS;
  const payload = await acliJson<unknown>([
    "jira",
    "workitem",
    "view",
    key,
    "--fields",
    requested,
    "--json",
  ]);
  const item = Array.isArray(payload) ? payload[0] : payload;
  if (!item || typeof item !== "object") {
    throw new AxiError(`Work item not found: ${key}`, "NOT_FOUND");
  }
  return item as JsonRecord;
}

async function runSearch(
  jql: string,
  limit: number,
  fields: string[] | undefined,
): Promise<JsonRecord[]> {
  const acliArgs = [
    "jira",
    "workitem",
    "search",
    "--jql",
    jql,
    "--limit",
    String(limit),
    "--json",
  ];
  if (fields) {
    acliArgs.push("--fields", fields.join(","));
  }
  const payload = await acliJson<unknown>(acliArgs);
  return itemsOf(payload, "issues", "workItems", "results", "values");
}

function renderSearchResults(
  action: "list" | "search",
  items: JsonRecord[],
  limit: number,
  fields: string[] | undefined,
  ctx?: SiteContext,
): string {
  const schema = fields ? fieldsSchema(fields) : workitemListSchema;
  const blocks: string[] = [
    formatCountLine({ count: items.length, limit }),
  ];
  if (items.length > 0) {
    blocks.push(renderList("workitems", items, schema));
  }
  blocks.push(
    renderHelp(
      getSuggestions({
        domain: "workitem",
        action,
        isEmpty: items.length === 0,
        site: ctx,
      }),
    ),
  );
  return renderOutput(blocks);
}

// ---------------------------------------------------------------------------
// list / search
// ---------------------------------------------------------------------------

async function listWorkitems(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const parsed = parseFlags(args, {
    values: [
      "--jql",
      "--project",
      "--assignee",
      "--status",
      "--limit",
      "--fields",
    ],
  });
  if (parsed.help) return WORKITEM_HELP;

  const jqlFlag = parsed.values["--jql"];
  const project = parsed.values["--project"];
  const assignee = parsed.values["--assignee"];
  const status = parsed.values["--status"];
  const limit = parseLimit(parsed.values["--limit"]);
  const fields = splitFields(parsed.values["--fields"]);

  if (jqlFlag && (project || assignee || status)) {
    throw new AxiError(
      "Use either --jql or the --project/--assignee/--status filters, not both",
      "VALIDATION_ERROR",
    );
  }

  const jql = jqlFlag ?? buildJql({ project, assignee, status });
  const items = await runSearch(jql, limit, fields);
  return renderSearchResults("list", items, limit, fields, ctx);
}

function buildJql(filters: {
  project?: string;
  assignee?: string;
  status?: string;
}): string {
  const clauses: string[] = [];
  if (filters.project) {
    clauses.push(`project = ${quoteJql(filters.project)}`);
  }
  if (filters.assignee) {
    clauses.push(
      filters.assignee === "@me"
        ? "assignee = currentUser()"
        : `assignee = ${quoteJql(filters.assignee)}`,
    );
  }
  if (filters.status) {
    clauses.push(`status = ${quoteJql(filters.status)}`);
  }
  const where = clauses.join(" AND ");
  // acli rejects unbounded JQL ("Unbounded JQL queries are not allowed"), so a
  // bare `list` gets a recency window instead of an unrestricted query.
  return where
    ? `${where} ORDER BY updated DESC`
    : "updated >= -30d ORDER BY updated DESC";
}

/** Quote a JQL string value; backslashes first, then quotes, per JQL escaping. */
function quoteJql(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function searchWorkitems(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const parsed = parseFlags(args, { values: ["--limit", "--fields"] });
  if (parsed.help) return WORKITEM_HELP;

  const jql = parsed.positional;
  if (!jql) {
    throw new AxiError("Missing JQL query", "VALIDATION_ERROR", [
      'Run `atlassian-axi jira workitem search "<JQL>"`',
    ]);
  }
  const limit = parseLimit(parsed.values["--limit"]);
  const fields = splitFields(parsed.values["--fields"]);
  const items = await runSearch(jql, limit, fields);
  return renderSearchResults("search", items, limit, fields, ctx);
}

// ---------------------------------------------------------------------------
// view
// ---------------------------------------------------------------------------

async function viewWorkitem(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const parsed = parseFlags(args, {
    values: ["--fields"],
    bools: ["--full", "--comments"],
  });
  if (parsed.help) return WORKITEM_HELP;

  const key = requireKey(parsed.positional, "view");
  const full = parsed.bools["--full"];
  const withComments = parsed.bools["--comments"];
  const fields = splitFields(parsed.values["--fields"]);

  // --full governs body truncation in the DEFAULT schema; a --fields render
  // never truncates, so the combination would be a silent no-op — reject it.
  if (fields && full) {
    throw new AxiError(
      "--full cannot be combined with --fields (a --fields render is never truncated)",
      "VALIDATION_ERROR",
      ["Drop --full, or drop --fields to render the default field set"],
    );
  }

  const item = await fetchWorkitem(key, fields);
  const blocks: string[] = [
    renderDetail(
      "workitem",
      item,
      fields ? fieldsSchema(fields) : workitemViewSchema(full),
    ),
  ];

  if (withComments) {
    const payload = await acliJson<unknown>([
      "jira",
      "workitem",
      "comment",
      "list",
      "--key",
      key,
      "--json",
    ]);
    const comments = itemsOf(payload, "comments", "values");
    if (comments.length > 0) {
      blocks.push(renderList("comments", comments, commentSchema(full)));
    } else {
      blocks.push("comments: none");
    }
  }

  blocks.push(
    renderHelp(
      getSuggestions({ domain: "workitem", action: "view", id: key, site: ctx }),
    ),
  );
  return renderOutput(blocks);
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

async function createWorkitem(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  // valueBoundaryFlags keeps `--body --summary "..."` from swallowing the
  // sibling flag as the description text.
  const body = takeBody(args, {
    valueBoundaryFlags: [
      "--project",
      "--type",
      "--summary",
      "--assignee",
      "--label",
    ],
  });
  const parsed = parseFlags(args, {
    values: ["--project", "--type", "--summary", "--assignee", "--label"],
  });
  if (parsed.help) return WORKITEM_HELP;

  const project = parsed.values["--project"];
  const type = parsed.values["--type"];
  const summary = parsed.values["--summary"];
  const assignee = parsed.values["--assignee"];
  const label = parsed.values["--label"];

  const missing = [
    !project ? "--project" : null,
    !type ? "--type" : null,
    !summary ? "--summary" : null,
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new AxiError(
      `Missing required flags: ${missing.join(", ")}`,
      "VALIDATION_ERROR",
      [
        'Run `atlassian-axi jira workitem create --project <KEY> --type Task --summary "..."`',
      ],
    );
  }

  const acliArgs = [
    "jira",
    "workitem",
    "create",
    "--project",
    project as string,
    "--type",
    type as string,
    "--summary",
    summary as string,
    "--json",
  ];
  if (body) acliArgs.push("--description", body);
  if (assignee) acliArgs.push("--assignee", assignee);
  if (label) acliArgs.push("--label", label);

  const created = await acliJson<unknown>(acliArgs);
  const key = firstKeyOf(created);

  if (!key) {
    // Shape drifted; still report success with whatever acli returned.
    return renderOutput([
      renderDetail(
        "workitem",
        { _message: "Created (key not detected in acli output)" },
        [field("_message", "message")],
      ),
    ]);
  }

  const item = await fetchWorkitem(key);
  return renderOutput([
    renderDetail("workitem", item, workitemViewSchema(false)),
    renderHelp(
      getSuggestions({
        domain: "workitem",
        action: "create",
        id: key,
        site: ctx,
      }),
    ),
  ]);
}

/** Find the created work item key in a tolerant way (shape is undocumented). */
function firstKeyOf(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const key = firstKeyOf(entry);
      if (key) return key;
    }
    return undefined;
  }
  const record = payload as JsonRecord;
  if (typeof record.key === "string" && record.key.includes("-")) {
    return record.key;
  }
  for (const nested of ["workitem", "issue", "issues", "workItems"]) {
    if (record[nested]) {
      const key = firstKeyOf(record[nested]);
      if (key) return key;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// edit
// ---------------------------------------------------------------------------

async function editWorkitem(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  // valueBoundaryFlags keeps `--body --summary "..."` from swallowing the
  // sibling flag as the description text.
  const body = takeBody(args, {
    valueBoundaryFlags: [
      "--summary",
      "--assignee",
      "--type",
      "--labels",
      "--remove-labels",
    ],
  });
  const parsed = parseFlags(args, {
    values: [
      "--summary",
      "--assignee",
      "--type",
      "--labels",
      "--remove-labels",
    ],
  });
  if (parsed.help) return WORKITEM_HELP;

  const key = requireKey(parsed.positional, "edit");
  const summary = parsed.values["--summary"];
  const assignee = parsed.values["--assignee"];
  const type = parsed.values["--type"];
  const labels = parsed.values["--labels"];
  const removeLabels = parsed.values["--remove-labels"];

  const acliArgs = ["jira", "workitem", "edit", "--key", key, "--yes", "--json"];
  let hasChanges = false;
  const pushChange = (flag: string, value: string | undefined) => {
    if (value) {
      acliArgs.push(flag, value);
      hasChanges = true;
    }
  };
  pushChange("--summary", summary);
  pushChange("--description", body);
  pushChange("--assignee", assignee);
  pushChange("--type", type);
  pushChange("--labels", labels);
  pushChange("--remove-labels", removeLabels);

  if (!hasChanges) {
    throw new AxiError("No changes specified", "VALIDATION_ERROR", [
      'Pass at least one of --summary, --body/--body-file, --assignee, --type, --labels, --remove-labels',
    ]);
  }

  await acliJson<unknown>(acliArgs);

  const item = await fetchWorkitem(key);
  return renderOutput([
    renderDetail("workitem", item, workitemViewSchema(false)),
    renderHelp(
      getSuggestions({ domain: "workitem", action: "edit", id: key, site: ctx }),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// transition
// ---------------------------------------------------------------------------

async function transitionWorkitem(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const parsed = parseFlags(args, { values: ["--to"] });
  if (parsed.help) return WORKITEM_HELP;

  const key = requireKey(parsed.positional, "transition");
  const to = parsed.values["--to"];
  if (!to) {
    throw new AxiError("Missing --to <status>", "VALIDATION_ERROR", [
      "Run `atlassian-axi jira workitem transition <KEY> --to <status>`",
    ]);
  }

  // Idempotent: a transition to the current status is a no-op success.
  const current = await fetchWorkitem(key);
  const currentStatus = nameOf(fieldOf(current, "status"));
  if (currentStatus && currentStatus.toLowerCase() === to.toLowerCase()) {
    return renderOutput([
      renderDetail(
        "workitem",
        { ...current, _message: `Already ${currentStatus}` },
        [...statusResultSchema(), field("_message", "message")],
      ),
      renderHelp(
        getSuggestions({
          domain: "workitem",
          action: "transition",
          id: key,
          site: ctx,
        }),
      ),
    ]);
  }

  await acliJson<unknown>([
    "jira",
    "workitem",
    "transition",
    "--key",
    key,
    "--status",
    to,
    "--yes",
    "--json",
  ]);

  const item = await fetchWorkitem(key);
  return renderOutput([
    renderDetail("workitem", item, statusResultSchema()),
    renderHelp(
      getSuggestions({
        domain: "workitem",
        action: "transition",
        id: key,
        site: ctx,
      }),
    ),
  ]);
}

function statusResultSchema() {
  return workitemViewSchema(false).filter((def) =>
    ["key", "summary", "status", "assignee"].includes(
      "as" in def ? (def.as ?? "") : "",
    ),
  );
}

// ---------------------------------------------------------------------------
// assign
// ---------------------------------------------------------------------------

async function assignWorkitem(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const parsed = parseFlags(args, { values: ["--assignee"] });
  if (parsed.help) return WORKITEM_HELP;

  const key = requireKey(parsed.positional, "assign");
  const assignee = parsed.values["--assignee"];
  if (!assignee) {
    throw new AxiError("Missing --assignee <email|@me>", "VALIDATION_ERROR", [
      "Run `atlassian-axi jira workitem assign <KEY> --assignee <email|@me>`",
    ]);
  }

  // Idempotent: skip the mutation when the target user is already assigned.
  // '@me'/'default' resolve server-side, so those always go through acli.
  const current = await fetchWorkitem(key);
  if (isAlreadyAssigned(current, assignee)) {
    const name = nameOf(fieldOf(current, "assignee"));
    return renderOutput([
      renderDetail(
        "workitem",
        { ...current, _message: `Already assigned to ${name}` },
        [...statusResultSchema(), field("_message", "message")],
      ),
      renderHelp(
        getSuggestions({
          domain: "workitem",
          action: "assign",
          id: key,
          site: ctx,
        }),
      ),
    ]);
  }

  await acliJson<unknown>([
    "jira",
    "workitem",
    "assign",
    "--key",
    key,
    "--assignee",
    assignee,
    "--yes",
    "--json",
  ]);

  const item = await fetchWorkitem(key);
  return renderOutput([
    renderDetail("workitem", item, statusResultSchema()),
    renderHelp(
      getSuggestions({
        domain: "workitem",
        action: "assign",
        id: key,
        site: ctx,
      }),
    ),
  ]);
}

function isAlreadyAssigned(item: JsonRecord, requested: string): boolean {
  if (requested === "@me" || requested === "default") return false;
  const assignee = fieldOf(item, "assignee");
  if (!assignee || typeof assignee !== "object") return false;
  const record = assignee as JsonRecord;
  const wanted = requested.toLowerCase();
  return [record.emailAddress, record.displayName, record.accountId].some(
    (candidate) =>
      typeof candidate === "string" && candidate.toLowerCase() === wanted,
  );
}

// ---------------------------------------------------------------------------
// comment
// ---------------------------------------------------------------------------

async function commentWorkitem(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  // Optional at first so `comment --help` reaches the help path; enforced below.
  const body = takeBody(args, { label: "comment" });
  const parsed = parseFlags(args, {});
  if (parsed.help) return WORKITEM_HELP;

  if (body === undefined) {
    throw new AxiError("--body or --body-file is required", "VALIDATION_ERROR", [
      'Use --body "..." for inline comment, or --body-file <path> for markdown from a file',
    ]);
  }
  const key = requireKey(parsed.positional, "comment");

  await acliJson<unknown>([
    "jira",
    "workitem",
    "comment",
    "create",
    "--key",
    key,
    "--body",
    body,
    "--json",
  ]);

  const item = await fetchWorkitem(key);
  return renderOutput([
    renderDetail("workitem", { ...item, _message: "Comment added" }, [
      ...statusResultSchema(),
      field("_message", "message"),
    ]),
    renderHelp(
      getSuggestions({
        domain: "workitem",
        action: "comment",
        id: key,
        site: ctx,
      }),
    ),
  ]);
}
