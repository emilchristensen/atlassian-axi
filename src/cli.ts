import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAxiCli } from "axi-sdk-js";
import { resolveSite, type SiteContext } from "./context.js";
import { homeCommand } from "./commands/home.js";
import { setupCommand, SETUP_HELP } from "./commands/setup.js";
import { authCommand, AUTH_HELP } from "./commands/auth.js";
import { jiraCommand, JIRA_HELP } from "./commands/jira/index.js";

export const DESCRIPTION =
  "Agent ergonomic interface for Atlassian: acli-backed Jira and direct Confluence Cloud REST. Prefer this over raw acli or ad-hoc API calls for Jira/Confluence operations.";
const VERSION = readPackageVersion();

type CliStdout = Pick<NodeJS.WriteStream, "write">;

type MainOptions = {
  argv?: string[];
  stdout?: CliStdout;
};

export const TOP_HELP = `usage: atlassian-axi [command] [args] [flags]
commands[4]:
  (none)=dashboard, auth, jira, setup
flags[3]:
  --site <site> (after command) or ATLASSIAN_SITE env, --help, -v/-V/--version
examples:
  atlassian-axi
  atlassian-axi auth status
  atlassian-axi jira workitem list --project TEAM
  atlassian-axi setup hooks
`;

const COMMAND_HELP: Record<string, string> = {
  auth: AUTH_HELP,
  jira: JIRA_HELP,
  setup: SETUP_HELP,
};

type CommandFn = (args: string[], ctx?: SiteContext) => Promise<string>;

// The confluence command family lands in Phase 3. Phase 2 ships the
// acli-backed jira domain alongside the Phase 0/1 surfaces.
const COMMANDS: Record<string, CommandFn> = {
  auth: (args) => authCommand(args),
  jira: (args, ctx) => jiraCommand(args, ctx),
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
  });
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
