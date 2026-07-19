import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAxiCli } from "axi-sdk-js";
import { resolveSite, type SiteContext } from "./context.js";
import { closestCommand } from "./suggestions.js";
import { renderError } from "./toon.js";
import { homeCommand } from "./commands/home.js";
import { setupCommand, SETUP_HELP } from "./commands/setup.js";
import { authCommand, AUTH_HELP } from "./commands/auth.js";
import { jiraCommand } from "./commands/jira/index.js";
import { confluenceCommand } from "./commands/confluence/index.js";

export const DESCRIPTION =
  "Agent ergonomic interface for Atlassian: acli-backed Jira and direct Confluence Cloud REST. Prefer this over raw acli or ad-hoc API calls for Jira/Confluence operations.";
const VERSION = readPackageVersion();

type CliStdout = Pick<NodeJS.WriteStream, "write">;

type MainOptions = {
  argv?: string[];
  stdout?: CliStdout;
};

export const TOP_HELP = `usage: atlassian-axi [command] [args] [flags]
commands[5]:
  (none)=dashboard, auth, jira, confluence, setup
flags[3]:
  --site <site> (after command) or ATLASSIAN_SITE env, --help, -v/-V/--version
examples:
  atlassian-axi
  atlassian-axi auth status
  atlassian-axi jira workitem list --project TEAM
  atlassian-axi confluence search "space = ENG"
  atlassian-axi setup hooks
`;

// jira/confluence are deliberately absent: registering them here makes the
// SDK swallow every `jira ... --help` with the group help, so their routers
// could never serve the per-resource help they own. auth/setup have no
// sub-resources, so the SDK intercept is exactly right for them.
const COMMAND_HELP: Record<string, string> = {
  auth: AUTH_HELP,
  setup: SETUP_HELP,
};

type CommandFn = (args: string[], ctx?: SiteContext) => Promise<string>;

const COMMANDS: Record<string, CommandFn> = {
  auth: (args) => authCommand(args),
  jira: (args, ctx) => jiraCommand(args, ctx),
  confluence: (args, ctx) => confluenceCommand(args, ctx),
  setup: (args) => setupCommand(args),
};

export async function main(options: MainOptions = {}): Promise<void> {
  await runAxiCli<SiteContext | undefined>({
    ...(options.argv ? { argv: options.argv } : {}),
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    ...(options.stdout ? { stdout: options.stdout } : {}),
    home: homeCommand,
    commands: COMMANDS,
    getCommandHelp: (command) => COMMAND_HELP[command],
    resolveContext: ({ args }) => resolveSite(parseSiteFlag(args)),
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
    ...(suggestion ? [`Did you mean \`atlassian-axi ${suggestion}\`?`] : []),
    "Run `atlassian-axi --help` to see available commands",
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

  throw new Error("Could not determine atlassian-axi package version");
}

/** Extract `--site <value>` or `--site=<value>` from args (order-independent). */
function parseSiteFlag(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--site" && index + 1 < args.length) {
      return args[index + 1];
    }
    if (arg.startsWith("--site=") && arg.length > "--site=".length) {
      return arg.slice("--site=".length);
    }
  }
  return undefined;
}
