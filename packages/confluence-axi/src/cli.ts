import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAxiCli } from "axi-sdk-js";
import {
  AxiError,
  closestCommand,
  exitCodeForError,
  renderError,
  resolveSite,
  takeValueFlag,
  type SiteContext,
} from "@atlassian-axi/core";
import { setSiteOverride } from "./config.js";
import { withSiteFlag } from "./suggestions.js";
import { homeCommand } from "./commands/home.js";
import { setupCommand, SETUP_HELP } from "./commands/setup.js";
import { authCommand, AUTH_HELP } from "./commands/auth.js";
import { pageCommand } from "./commands/confluence/page.js";
import { spaceCommand } from "./commands/confluence/space.js";
import { searchCommand } from "./commands/confluence/search.js";

export const DESCRIPTION =
  "Agent-ergonomic Confluence Cloud CLI over the REST API directly, with token-efficient TOON output and OAuth 3LO + API-token auth.";
const VERSION = readPackageVersion();

type CliStdout = Pick<NodeJS.WriteStream, "write">;

type MainOptions = {
  argv?: string[];
  stdout?: CliStdout;
};

export const TOP_HELP = `usage: confluence-axi [command] [args] [flags]
commands[6]:
  (none)=dashboard, auth, page, space, search, setup
flags[3]:
  --site <site> (after command) or ATLASSIAN_SITE env, --help, -v/-V/--version
examples:
  confluence-axi
  confluence-axi auth status
  confluence-axi page get 12345
  confluence-axi space list
  confluence-axi search "space = ENG"
  confluence-axi setup hooks
`;

// page/space/search are deliberately absent from COMMAND_HELP: registering a
// command here makes the SDK swallow every deep `<command> ... --help` with
// the group help, so those command functions own their own per-subcommand
// help. auth/setup have no sub-resources, so the SDK intercept is right there.
const COMMAND_HELP: Record<string, string> = {
  auth: AUTH_HELP,
  setup: SETUP_HELP,
};

type CommandFn = (args: string[], ctx?: SiteContext) => Promise<string>;

/**
 * The SDK's resolveContext reads --site but leaves it in the args, so strip it
 * before dispatch or parseFlags rejects it as an unknown flag. Immutable: the
 * caller's array is never mutated.
 *
 * takeValueFlag, not takeFlag: a missing or flag-shaped `--site` value is a loud
 * VALIDATION_ERROR (exit 2) here too, matching resolveContext's parseSiteFlag —
 * otherwise `page get 123 --site --full` would silently swallow `--full` as the
 * site and render a truncated page at exit 0 (AXI principle 6).
 */
export function stripSite(args: string[]): string[] {
  const rest = [...args];
  takeValueFlag(rest, "--site");
  return rest;
}

const COMMANDS: Record<string, CommandFn> = {
  auth: (args) => authCommand(args),
  page: (args, ctx) => pageCommand(stripSite(args), ctx),
  space: (args, ctx) => spaceCommand(stripSite(args), ctx),
  // search has no subcommand; its command function skips args[0] before
  // reading the CQL positional, so inject a "search" placeholder there.
  search: (args, ctx) => searchCommand(["search", ...stripSite(args)], ctx),
  setup: (args) => setupCommand(args),
};

/**
 * Render a thrown error in the SDK's TOON error shape, carrying an explicit
 * `--site` into every suggestion line the way the success path does (the SDK
 * renders error.suggestions verbatim, so the CLI owns this).
 */
export function formatCliError(
  error: unknown,
  site?: SiteContext,
): { output: string; exitCode: number } {
  if (error instanceof AxiError) {
    return {
      output: `${renderError(
        error.message,
        error.code,
        withSiteFlag(error.suggestions ?? [], site),
      )}\n`,
      exitCode: exitCodeForError(error),
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { output: `${renderError(message, "UNKNOWN")}\n`, exitCode: 1 };
}

export async function main(options: MainOptions = {}): Promise<void> {
  // The SDK's formatError hook receives only the error, so the site resolved
  // for THIS invocation is captured here (same lifetime as setSiteOverride).
  let site: SiteContext | undefined;
  await runAxiCli<SiteContext | undefined>({
    ...(options.argv ? { argv: options.argv } : {}),
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    ...(options.stdout ? { stdout: options.stdout } : {}),
    home: homeCommand,
    commands: COMMANDS,
    getCommandHelp: (command) => COMMAND_HELP[command],
    resolveContext: ({ args }) => {
      const ctx = resolveSite(parseSiteFlag(args));
      // Feed the --site flag into credential resolution (flag > env > stored);
      // without this the flag only decorated help lines while every request
      // silently hit the stored site (found live 2026-07-19).
      setSiteOverride(ctx?.source === "flag" ? ctx.site : undefined);
      site = ctx;
      return ctx;
    },
    renderUnknownCommand,
    formatError: (error) => formatCliError(error, site),
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
    ...(suggestion ? [`Did you mean \`confluence-axi ${suggestion}\`?`] : []),
    "Run `confluence-axi --help` to see available commands",
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

  throw new Error("Could not determine confluence-axi package version");
}

/**
 * Extract `--site <value>` or `--site=<value>` from args (order-independent).
 * A `--site` with a missing value or one immediately followed by another flag
 * is a loud VALIDATION_ERROR — otherwise `--site --limit 5` would silently make
 * "--limit" the site (request to https://--limit/...) and drop the real flag.
 * Safe to throw here: bin's top-level `.catch` renders a thrown AxiError from
 * resolveContext (the SDK awaits resolveContext outside its own try/catch).
 */
function parseSiteFlag(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--site") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new AxiError("--site requires a value", "VALIDATION_ERROR", [
          "Pass the site host after the flag: --site acme.atlassian.net",
        ]);
      }
      return value;
    }
    if (arg.startsWith("--site=") && arg.length > "--site=".length) {
      return arg.slice("--site=".length);
    }
  }
  return undefined;
}
