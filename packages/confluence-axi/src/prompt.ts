import { createInterface } from "node:readline/promises";
import { AxiError } from "./errors.js";

/**
 * Interactive TTY prompts for the OAuth login flow. Callers guard with
 * `isInteractiveTTY()` first — these are never reached in agent/CI contexts.
 * All prompt text goes to stderr so stdout stays clean TOON output.
 */

/**
 * Read a secret from the terminal with echo suppressed (each keystroke is
 * masked). Used once, on first OAuth login, for the client secret.
 */
export function promptHidden(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stderr.write(`${label}: `);
    const wasRaw = stdin.isRaw ?? false;
    stdin.setRawMode?.(true);
    stdin.resume();
    let value = "";

    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode?.(wasRaw);
      stdin.pause();
      process.stderr.write("\n");
    };

    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n") {
          cleanup();
          if (value.trim() === "") {
            reject(
              new AxiError("Empty secret — nothing was stored", "VALIDATION_ERROR", [
                "Re-run `confluence-axi auth login` and paste the OAuth client secret",
              ]),
            );
          } else {
            resolve(value.trim());
          }
          return;
        }
        if (char === "\u0003") {
          // Ctrl-C
          cleanup();
          reject(new AxiError("Login aborted", "VALIDATION_ERROR"));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
        process.stderr.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

/**
 * Numbered single-choice prompt. Rejects loudly after three invalid answers
 * instead of looping forever.
 */
export async function promptSelect(
  label: string,
  options: string[],
): Promise<number> {
  process.stderr.write(`${label}\n`);
  options.forEach((option, index) => {
    process.stderr.write(`  ${index + 1}. ${option}\n`);
  });
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const answer = (await rl.question(`Choose [1-${options.length}]: `)).trim();
      const index = Number.parseInt(answer, 10);
      if (Number.isInteger(index) && index >= 1 && index <= options.length) {
        return index - 1;
      }
      process.stderr.write(`Not a valid choice: "${answer}"\n`);
    }
  } finally {
    rl.close();
  }
  throw new AxiError("No valid selection made", "VALIDATION_ERROR", [
    "Re-run `confluence-axi auth login` and answer with the number of a listed site",
  ]);
}
