import { acliExec, acliJson } from "../../acli.js";
import type { SiteContext } from "../../context.js";
import { AxiError } from "../../errors.js";
import { unknownSubcommandError } from "../shared.js";
import { getSuggestions } from "../../suggestions.js";
import {
  custom,
  field,
  renderDetail,
  renderHelp,
  renderOutput,
  type FieldDef,
} from "../../toon.js";
import { parseFlags, type JsonRecord } from "./shared.js";

export const FIELD_HELP = `usage: atlassian-axi jira field <subcommand> [flags]
subcommands[4]:
  create, update <ID>, delete <ID>, restore <ID>
notes[3]:
  acli has no field list/view; use \`jira workitem view <KEY> --fields <a,b,c>\` to inspect field values
  delete moves the custom field to trash (restorable via restore); IDs look like customfield_12345
  a bare numeric ID <n> is accepted and expanded to customfield_<n> (the expanded ID is echoed in the output)
flags{create}:
  --name <text> (required), --type <full type key, e.g. com.atlassian.jira.plugin.system.customfieldtypes:textfield> (required), --description <text>, --searcher-key <key>
flags{update}:
  --name <text>, --description <text>, --searcher-key <key>
examples:
  atlassian-axi jira field create --name "Customer Name" --type "com.atlassian.jira.plugin.system.customfieldtypes:textfield"
  atlassian-axi jira field update customfield_12345 --name "Client Name"
  atlassian-axi jira field delete customfield_12345`;

/**
 * Field detail schema: acli field create/update --json mirrors the Jira REST
 * custom-field shape ({id, name, description, schema.custom, searcherKey}).
 * The shape is a mutation response we could not capture live (creating fields
 * on a production site), so rendering is a tolerant probe with a message
 * fallback - never a parse failure.
 */
const fieldViewSchema: FieldDef[] = [
  custom("id", (item: JsonRecord) => item.id ?? null),
  custom("name", (item: JsonRecord) => item.name ?? null),
  custom(
    "type",
    (item: JsonRecord) =>
      (item.schema as JsonRecord | undefined)?.custom ?? item.type ?? null,
  ),
  custom("description", (item: JsonRecord) => item.description || "none"),
];

export async function fieldCommand(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const sub = args[0];

  if (!sub || sub === "--help") {
    return FIELD_HELP;
  }

  switch (sub) {
    case "create":
      return createField(args, ctx);
    case "update":
      return updateField(args, ctx);
    case "delete":
      return deleteField(args, ctx);
    case "restore":
      return restoreField(args, ctx);
    default:
      throw unknownSubcommandError(
        "field subcommand",
        sub,
        ["create", "update", "delete", "restore"],
        "atlassian-axi jira field --help",
      );
  }
}

/** Custom-field IDs are `customfield_<n>`; accept a bare number too (explicitly, not silently). */
function requireFieldId(raw: string | undefined, usage: string): string {
  if (!raw) {
    throw new AxiError("Missing field ID", "VALIDATION_ERROR", [usage]);
  }
  if (/^customfield_\d+$/.test(raw)) return raw;
  if (/^\d+$/.test(raw)) return `customfield_${raw}`;
  throw new AxiError(
    `Invalid field ID: ${raw} (expected customfield_<n>)`,
    "VALIDATION_ERROR",
    [usage],
  );
}

async function createField(args: string[], ctx?: SiteContext): Promise<string> {
  const parsed = parseFlags(args, {
    values: ["--name", "--type", "--description", "--searcher-key"],
  });
  if (parsed.help) return FIELD_HELP;

  const name = parsed.values["--name"];
  const type = parsed.values["--type"];
  const missing = [!name ? "--name" : null, !type ? "--type" : null].filter(
    Boolean,
  );
  if (missing.length > 0) {
    throw new AxiError(
      `Missing required flags: ${missing.join(", ")}`,
      "VALIDATION_ERROR",
      [
        'Run `atlassian-axi jira field create --name "..." --type "com.atlassian.jira.plugin.system.customfieldtypes:textfield"`',
      ],
    );
  }

  const acliArgs = [
    "jira",
    "field",
    "create",
    "--name",
    name as string,
    "--type",
    type as string,
    "--json",
  ];
  const description = parsed.values["--description"];
  const searcherKey = parsed.values["--searcher-key"];
  if (description) acliArgs.push("--description", description);
  if (searcherKey) acliArgs.push("--searcher-key", searcherKey);

  const created = await acliJson<unknown>(acliArgs);
  const item =
    created && typeof created === "object" && !Array.isArray(created)
      ? (created as JsonRecord)
      : { name, type };

  return renderOutput([
    renderDetail("field", { ...item, _message: "Field created" }, [
      ...fieldViewSchema,
      field("_message", "message"),
    ]),
    renderHelp(
      getSuggestions({
        domain: "field",
        action: "create",
        ...(typeof item.id === "string" ? { id: item.id } : {}),
        site: ctx,
      }),
    ),
  ]);
}

async function updateField(args: string[], ctx?: SiteContext): Promise<string> {
  const parsed = parseFlags(args, {
    values: ["--name", "--description", "--searcher-key"],
  });
  if (parsed.help) return FIELD_HELP;
  const id = requireFieldId(
    parsed.positional,
    'Run `atlassian-axi jira field update customfield_<n> --name "..."`',
  );

  const name = parsed.values["--name"];
  const description = parsed.values["--description"];
  const searcherKey = parsed.values["--searcher-key"];
  if (!name && !description && !searcherKey) {
    throw new AxiError("No changes specified", "VALIDATION_ERROR", [
      "Pass at least one of --name, --description, --searcher-key",
    ]);
  }

  const acliArgs = ["jira", "field", "update", "--id", id, "--json"];
  if (name) acliArgs.push("--name", name);
  if (description) acliArgs.push("--description", description);
  if (searcherKey) acliArgs.push("--searcher-key", searcherKey);

  const updated = await acliJson<unknown>(acliArgs);
  const item =
    updated && typeof updated === "object" && !Array.isArray(updated)
      ? (updated as JsonRecord)
      : { id };

  return renderOutput([
    renderDetail("field", { id, ...item, _message: "Field updated" }, [
      ...fieldViewSchema,
      field("_message", "message"),
    ]),
    renderHelp(
      getSuggestions({ domain: "field", action: "update", id, site: ctx }),
    ),
  ]);
}

async function deleteField(args: string[], ctx?: SiteContext): Promise<string> {
  const parsed = parseFlags(args, {});
  if (parsed.help) return FIELD_HELP;
  const id = requireFieldId(
    parsed.positional,
    "Run `atlassian-axi jira field delete customfield_<n>`",
  );

  // acli field delete has no --json (verified against v1.3.22); success is
  // exit 0, so render our own confirmation instead of parsing output.
  await acliExec(["jira", "field", "delete", "--id", id]);

  return renderOutput([
    renderDetail("field", { id, _message: "Moved to trash" }, [
      field("id"),
      field("_message", "message"),
    ]),
    renderHelp(
      getSuggestions({ domain: "field", action: "delete", id, site: ctx }),
    ),
  ]);
}

async function restoreField(
  args: string[],
  ctx?: SiteContext,
): Promise<string> {
  const parsed = parseFlags(args, {});
  if (parsed.help) return FIELD_HELP;
  const id = requireFieldId(
    parsed.positional,
    "Run `atlassian-axi jira field restore customfield_<n>`",
  );

  // acli field restore has no --json (verified against v1.3.22).
  await acliExec(["jira", "field", "restore", "--id", id]);

  return renderOutput([
    renderDetail("field", { id, _message: "Restored from trash" }, [
      field("id"),
      field("_message", "message"),
    ]),
    renderHelp(
      getSuggestions({ domain: "field", action: "restore", id, site: ctx }),
    ),
  ]);
}
