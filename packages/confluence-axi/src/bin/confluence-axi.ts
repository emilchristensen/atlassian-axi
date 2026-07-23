import { formatCliError, main } from "../cli.js";

// The SDK awaits resolveContext (which parses --site) OUTSIDE its own
// try/catch, so a thrown AxiError there would otherwise surface as an
// unhandled promise rejection with a raw stack trace and no exit-code shaping.
// Catch it here and render it through the same helper the SDK's formatError
// hook uses (site is undefined pre-resolution, so the --site pass is a no-op).
main().catch((error: unknown) => {
  const { output, exitCode } = formatCliError(error);
  process.stdout.write(output);
  process.exitCode = exitCode;
});
