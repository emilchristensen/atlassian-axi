import { AxiError, installSessionStartHooks } from "axi-sdk-js";
import { renderHelp, renderOutput } from "@atlassian-axi/core";

export const SETUP_HELP = `usage: jira-axi setup hooks
Install or repair agent SessionStart hooks for jira-axi ambient context.

examples:
  jira-axi setup hooks
`;

export async function setupCommand(args: string[]): Promise<string> {
  // Bare `setup` is a help request, matching the resource command routers.
  if (args.length === 0 || args[0] === "--help") {
    return SETUP_HELP;
  }
  if (args.length !== 1 || args[0] !== "hooks") {
    throw new AxiError(`Unknown setup action: ${args[0]}`, "VALIDATION_ERROR", [
      "Run `jira-axi setup hooks`",
    ]);
  }

  return installHooks();
}

/**
 * Install the SessionStart hooks and report what actually happened.
 *
 * The SDK writes each target (~/.claude/settings.json, ~/.codex/hooks.json,
 * ~/.codex/config.toml, the OpenCode plugin) independently and swallows every
 * per-target failure into `onError` instead of throwing. Without a collector a
 * malformed settings file or a permissions error is invisible and the agent is
 * told the hooks were installed when they were not, so collect the failures
 * and downgrade the reported status to `partial` when any fired.
 */
function installHooks(): string {
  const failures: string[] = [];
  installSessionStartHooks({
    onError: (message) => {
      failures.push(message);
    },
  });

  if (failures.length === 0) {
    return renderOutput([
      "hooks:\n  status: installed\n  integrations: Claude Code, Codex, OpenCode",
      renderHelp([
        "Restart your agent session to receive jira-axi ambient context",
      ]),
    ]);
  }

  return renderOutput([
    [
      "hooks:",
      "  status: partial",
      "  integrations: Claude Code, Codex, OpenCode",
      `  failures[${failures.length}]:`,
      // Flatten each message: a multi-line error would break the TOON block.
      ...failures.map((message) => `    ${message.replace(/\s*\r?\n\s*/g, " ")}`),
    ].join("\n"),
    renderHelp([
      "At least one integration was NOT written, so its ambient context is missing",
      "Fix the file named in each failure (usually a malformed JSON/TOML config or a permissions problem)",
      "Re-run `jira-axi setup hooks` afterwards - the install is idempotent",
    ]),
  ]);
}
