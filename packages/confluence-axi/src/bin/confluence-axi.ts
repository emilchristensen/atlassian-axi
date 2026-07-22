import { AxiError, exitCodeForError, renderError } from "@atlassian-axi/core";
import { main } from "../cli.js";

// The SDK awaits resolveContext (which parses --site) OUTSIDE its own
// try/catch, so a thrown AxiError there would otherwise surface as an
// unhandled promise rejection with a raw stack trace and no exit-code shaping.
// Catch it here and render it in the same TOON error shape the SDK uses.
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
