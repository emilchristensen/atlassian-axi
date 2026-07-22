import { acliJson } from "../../acli.js";
import type { SiteContext } from "@atlassian-axi/core";
import { AxiError } from "@atlassian-axi/core";
import { unknownSubcommandError } from "@atlassian-axi/core";
import { formatCountLine } from "@atlassian-axi/core";
import { getSuggestions } from "../../suggestions.js";
import {
  custom,
  field,
  renderDetail,
  renderHelp,
  renderList,
  renderOutput,
  truncateBody,
  type FieldDef,
} from "@atlassian-axi/core";
import {
  itemsOf,
  nameOf,
  parseFlags,
  parseLimit,
  rejectExtraPositional,
  requireNumericId,
  type JsonRecord,
} from "./shared.js";

export const FILTER_HELP = `usage: jira-axi filter <subcommand> [flags]
subcommands[4]:
  list, search, view <ID>, update <ID>
flags{list}:
  --favourite (my favourite filters; default is filters I own), --limit <n> (default 30, applied client-side)
flags{search}:
  --name <substring>, --owner <email>, --limit <n> (default 30)
flags{view}:
  --full (complete description without truncation)
flags{update}:
  --name <text>, --description <text>, --jql <query> (no-op success when nothing changes)
examples:
  jira-axi filter list
  jira-axi filter search --name backlog
  jira-axi filter view 33312
  jira-axi filter update 33312 --jql "project = TEAM AND status = Open"`;

/**
 * Filter schemas: acli filter payloads are flat REST filters ({id, name,
 * description, owner, jql, favourite}; verified live against v1.3.22 - the
 * search shape omits jql/favourite, view carries them). Accessors stay
 * tolerant per risk R3.
 */
const filterListSchema: FieldDef[] = [
  custom("id", (item: JsonRecord) => item.id ?? null),
  custom("name", (item: JsonRecord) => item.name ?? null),
  custom("owner", (item: JsonRecord) => nameOf(item.owner) ?? "unknown"),
];

/** Detail schema for `view`/`update`; description truncated unless --full. */
function filterViewSchema(full = false): FieldDef[] {
  return [
    ...filterListSchema,
    custom("jql", (item: JsonRecord) => item.jql ?? null),
    custom("favourite", (item: JsonRecord) => (item.favourite ? "yes" : "no")),
    custom("description", (item: JsonRecord) => {
      const text = typeof item.description === "string" ? item.description : "";
      if (!text) return "none";
      return full
        ? text
        : truncateBody(text, 500, {
            fullHint: "use `filter view <ID> --full` for the complete text",
          });
    }),
  ];
}

export async function filterCommand(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const sub = args[0];

  if (!sub || sub === "--help") {
    return FILTER_HELP;
  }

  switch (sub) {
    case "list":
      return listFilters(args, ctx);
    case "search":
      return searchFilters(args, ctx);
    case "view":
      return viewFilter(args, ctx);
    case "update":
      return updateFilter(args, ctx);
    default:
      throw unknownSubcommandError(
        "filter subcommand",
        sub,
        ["list", "search", "view", "update"],
        "jira-axi filter --help",
      );
  }
}

async function listFilters(args: string[], ctx?: SiteContext): Promise<string> {
  const parsed = parseFlags(args, {
    values: ["--limit"],
    bools: ["--favourite"],
  });
  if (parsed.help) return FILTER_HELP;
  const favourite = parsed.bools["--favourite"];
  const limit = parseLimit(parsed.values["--limit"]);

  // acli requires exactly one of --my/--favourite; ours defaults to --my.
  // acli filter list has NO --limit (unlike every other collection), so the
  // fetch is unbounded and we slice client-side to keep the flag surface
  // uniform across list commands.
  const payload = await acliJson<unknown>([
    "jira",
    "filter",
    "list",
    favourite ? "--favourite" : "--my",
    "--json",
  ]);
  const items = itemsOf(payload, "values", "filters");
  const shown = items.slice(0, limit);

  const blocks: string[] = [
    formatCountLine({
      count: items.length,
      ...(items.length > shown.length ? { displayLimit: limit } : {}),
    }),
  ];
  if (shown.length > 0) {
    blocks.push(renderList("filters", shown, filterListSchema));
  }
  blocks.push(
    renderHelp(
      getSuggestions({
        domain: "filter",
        action: "list",
        state: favourite ? "favourite" : "my",
        isEmpty: items.length === 0,
        site: ctx,
      }),
    ),
  );
  return renderOutput(blocks);
}

async function searchFilters(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const parsed = parseFlags(args, { values: ["--name", "--owner", "--limit"] });
  if (parsed.help) return FILTER_HELP;
  // A bare positional is --name shorthand (`filter search bolia`); silently
  // discarding it made the unfiltered list read as a (wrong) match set.
  if (parsed.positional && parsed.values["--name"]) {
    throw new AxiError(
      `Pass the name query once: either \`filter search ${parsed.positional}\` or --name`,
      "VALIDATION_ERROR",
      ['Run `jira-axi filter search --name "<text>"`'],
    );
  }
  // An unquoted multi-word query would silently search only its first word —
  // the same silent-discard bug class the shorthand itself fixed.
  rejectExtraPositional(
    args,
    'Quote a multi-word query: `jira-axi filter search "my filters"`',
  );
  const name = parsed.values["--name"] ?? parsed.positional;
  const owner = parsed.values["--owner"];
  const limit = parseLimit(parsed.values["--limit"]);

  const acliArgs = [
    "jira",
    "filter",
    "search",
    "--limit",
    String(limit),
    "--json",
  ];
  if (name) acliArgs.push("--name", name);
  if (owner) acliArgs.push("--owner", owner);

  const payload = await acliJson<unknown>(acliArgs);
  const items = itemsOf(payload, "values", "filters");

  const blocks: string[] = [formatCountLine({ count: items.length, limit })];
  if (items.length > 0) {
    blocks.push(renderList("filters", items, filterListSchema));
  }
  blocks.push(
    renderHelp(
      getSuggestions({
        domain: "filter",
        action: "search",
        isEmpty: items.length === 0,
        site: ctx,
      }),
    ),
  );
  return renderOutput(blocks);
}

/** Fetch one filter by ID (acli filter view --json returns one flat object). */
async function fetchFilter(id: string): Promise<JsonRecord> {
  const payload = await acliJson<unknown>([
    "jira",
    "filter",
    "view",
    "--id",
    id,
    "--json",
  ]);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AxiError(`Filter not found: ${id}`, "NOT_FOUND");
  }
  return payload as JsonRecord;
}

async function viewFilter(args: string[], ctx?: SiteContext): Promise<string> {
  const parsed = parseFlags(args, { bools: ["--full"] });
  if (parsed.help) return FILTER_HELP;
  const full = parsed.bools["--full"];
  const id = requireNumericId(
    parsed.positional,
    "Run `jira-axi filter view <ID>` (find IDs via `jira filter list` or `jira filter search`)",
    "filter ID",
  );
  rejectExtraPositional(args, "This command takes a single filter <ID>: jira-axi filter view <ID>");

  const item = await fetchFilter(id);
  return renderOutput([
    renderDetail("filter", item, filterViewSchema(full)),
    renderHelp(
      getSuggestions({ domain: "filter", action: "view", id, site: ctx }),
    ),
  ]);
}

async function updateFilter(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const parsed = parseFlags(args, {
    values: ["--name", "--description", "--jql"],
  });
  if (parsed.help) return FILTER_HELP;
  const id = requireNumericId(
    parsed.positional,
    'Run `jira-axi filter update <ID> --jql "..."`',
    "filter ID",
  );
  rejectExtraPositional(
    args,
    'This command takes a single filter <ID>; pass changes as flags: jira-axi filter update <ID> --jql "..."',
  );

  const name = parsed.values["--name"];
  const description = parsed.values["--description"];
  const jql = parsed.values["--jql"];

  if (!name && !description && !jql) {
    throw new AxiError("No changes specified", "VALIDATION_ERROR", [
      "Pass at least one of --name, --description, --jql",
    ]);
  }

  // Idempotent: skip the mutation when every requested value already matches.
  const current = await fetchFilter(id);
  const unchanged =
    (name === undefined || current.name === name) &&
    (description === undefined || current.description === description) &&
    (jql === undefined || current.jql === jql);
  if (unchanged) {
    return renderOutput([
      renderDetail("filter", { ...current, _message: "Already up to date" }, [
        ...filterViewSchema(),
        field("_message", "message"),
      ]),
      renderHelp(
        getSuggestions({ domain: "filter", action: "update", id, site: ctx }),
      ),
    ]);
  }

  const acliArgs = ["jira", "filter", "update", "--id", id, "--json"];
  if (name) acliArgs.push("--name", name);
  if (description) acliArgs.push("--description", description);
  if (jql) acliArgs.push("--jql", jql);

  await acliJson<unknown>(acliArgs);

  const item = await fetchFilter(id);
  return renderOutput([
    renderDetail("filter", item, filterViewSchema()),
    renderHelp(
      getSuggestions({ domain: "filter", action: "update", id, site: ctx }),
    ),
  ]);
}
