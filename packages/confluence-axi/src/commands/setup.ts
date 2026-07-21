import { AxiError, installSessionStartHooks } from "axi-sdk-js";
import { renderHelp, renderOutput } from "@atlassian-axi/core";

export const SETUP_HELP = `usage: confluence-axi setup hooks
Install or repair agent SessionStart hooks for confluence-axi ambient context.

examples:
  confluence-axi setup hooks
`;

export async function setupCommand(args: string[]): Promise<string> {
  // Bare `setup` is a help request, matching the other command routers.
  if (args.length === 0 || args[0] === "--help") {
    return SETUP_HELP;
  }
  if (args.length !== 1 || args[0] !== "hooks") {
    throw new AxiError(`Unknown setup action: ${args[0]}`, "VALIDATION_ERROR", [
      "Run `confluence-axi setup hooks`",
    ]);
  }

  installSessionStartHooks();

  return renderOutput([
    "hooks:\n  status: installed\n  integrations: Claude Code, Codex, OpenCode",
    renderHelp([
      "Restart your agent session to receive confluence-axi ambient context",
    ]),
  ]);
}
