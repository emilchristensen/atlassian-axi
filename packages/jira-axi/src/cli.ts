import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAxiCli } from "axi-sdk-js";
import { closestCommand, renderError } from "@atlassian-axi/core";
import { homeCommand } from "./commands/home.js";
import { setupCommand, SETUP_HELP } from "./commands/setup.js";
import { workitemCommand, WORKITEM_HELP } from "./commands/jira/workitem.js";
import { projectCommand, PROJECT_HELP } from "./commands/jira/project.js";
import { boardCommand, BOARD_HELP } from "./commands/jira/board.js";
import { sprintCommand, SPRINT_HELP } from "./commands/jira/sprint.js";
import { filterCommand, FILTER_HELP } from "./commands/jira/filter.js";
import { dashboardCommand, DASHBOARD_HELP } from "./commands/jira/dashboard.js";
import { fieldCommand, FIELD_HELP } from "./commands/jira/field.js";

// The SDK prints this verbatim as the home header on every no-arg invocation
// (the SessionStart hook target), so it stays ONE sentence per the AXI spec.
// Anything longer belongs in TOP_HELP, which an agent only pays for on --help.
export const DESCRIPTION =
  "Agent-ergonomic Jira CLI backed by Atlassian's acli, with token-efficient TOON output and self-contained auth (no extra credential setup).";
const VERSION = readPackageVersion();

type CliStdout = Pick<NodeJS.WriteStream, "write">;

type MainOptions = {
  argv?: string[];
  stdout?: CliStdout;
};

export const TOP_HELP = `usage: jira-axi [command] [args] [flags]
commands[9]:
  (none)=dashboard, workitem, project, board, sprint, filter, dashboard, field, setup
flags[2]:
  --help, -v/-V/--version
notes[2]:
  Token-efficient TOON output, contextual suggestions, idempotent mutations.
  Auth is delegated to acli's own login (\`acli jira auth login\`) - no extra credential setup.
examples:
  jira-axi
  jira-axi workitem list --project TEAM
  jira-axi board list-sprints 1013 --state active
  jira-axi sprint list-workitems 5205 --board 1013
  jira-axi setup hooks
`;

// Each resource owns one monolithic help doc (WORKITEM_HELP etc.). Registering
// it here lets the SDK serve that help for any `--help` under the resource
// (`jira-axi workitem --help`, `jira-axi workitem list --help`), so the resource
// command functions never have to intercept a deep --help themselves.
const COMMAND_HELP: Record<string, string> = {
  workitem: WORKITEM_HELP,
  project: PROJECT_HELP,
  board: BOARD_HELP,
  sprint: SPRINT_HELP,
  filter: FILTER_HELP,
  dashboard: DASHBOARD_HELP,
  field: FIELD_HELP,
  setup: SETUP_HELP,
};

type CommandFn = (args: string[]) => Promise<string>;

const COMMANDS: Record<string, CommandFn> = {
  workitem: (args) => workitemCommand(args),
  project: (args) => projectCommand(args),
  board: (args) => boardCommand(args),
  sprint: (args) => sprintCommand(args),
  filter: (args) => filterCommand(args),
  dashboard: (args) => dashboardCommand(args),
  field: (args) => fieldCommand(args),
  setup: (args) => setupCommand(args),
};

export async function main(options: MainOptions = {}): Promise<void> {
  await runAxiCli({
    ...(options.argv ? { argv: options.argv } : {}),
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    ...(options.stdout ? { stdout: options.stdout } : {}),
    home: homeCommand,
    commands: COMMANDS,
    getCommandHelp: (command) => COMMAND_HELP[command],
    renderUnknownCommand,
  });
}

/**
 * SDK hook for unknown top-level commands: same VALIDATION_ERROR/exit-2 shape
 * as the SDK default, plus a did-you-mean when the typo is close.
 */
export function renderUnknownCommand(command: string): string {
  const known = [...Object.keys(COMMANDS), "update"];
  const suggestion = closestCommand(command, known);
  return `${renderError(`Unknown command: ${command}`, "VALIDATION_ERROR", [
    ...(suggestion ? [`Did you mean \`jira-axi ${suggestion}\`?`] : []),
    "Run `jira-axi --help` to see available commands",
  ])}\n`;
}

function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));

  for (const candidate of [
    join(here, "..", "package.json"),
    join(here, "..", "..", "package.json"),
  ]) {
    if (!existsSync(candidate)) {
      continue;
    }

    const parsed = JSON.parse(readFileSync(candidate, "utf-8")) as {
      version?: unknown;
    };
    if (typeof parsed.version === "string" && parsed.version.length > 0) {
      return parsed.version;
    }
  }

  throw new Error("Could not determine jira-axi package version");
}
