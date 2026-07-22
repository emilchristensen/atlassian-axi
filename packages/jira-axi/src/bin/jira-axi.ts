import { AxiError, exitCodeForError, renderError } from "@atlassian-axi/core";
import { main } from "../cli.js";

// Defense-in-depth: jira-axi passes no resolveContext, so runAxiCli shapes every
// command error inside its own try/catch today. But any future rejection that
// escapes it (a resolveContext added later, or an SDK-level throw) would surface
// as an unhandled promise rejection with a raw stack and no exit-code shaping.
// Catch it here and render it in the same TOON error shape the SDK uses — the
// pattern confluence-axi's bin already relies on for its --site parsing.
main().catch((error: unknown) => {
  if (error instanceof AxiError) {
    process.stdout.write(
      `${renderError(error.message, error.code, error.suggestions)}\n`,
    );
    process.exitCode = exitCodeForError(error);
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(`${renderError(message, "UNKNOWN")}\n`);
  process.exitCode = 1;
});
