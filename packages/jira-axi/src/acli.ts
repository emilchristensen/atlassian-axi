import { execFile } from "node:child_process";
import { AxiError, acliNotInstalledError, mapError } from "./errors.js";

/** Result of running the `acli` binary. */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Low-level runner: given argv (and optional stdin), resolve an ExecResult.
 * Injectable so tests can fake acli without a real binary or credentials.
 * A runner signals a missing binary by resolving `stderr === "ENOENT"`.
 */
export type AcliRunner = (args: string[], stdin?: string) => Promise<ExecResult>;

const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10 MB
const DEFAULT_TIMEOUT_MS = 15_000;

/** Real runner: shell out to `acli` via execFile (argv only, no shell). */
const defaultRunner: AcliRunner = (args, stdin) =>
  new Promise((resolve) => {
    const child = execFile(
      "acli",
      args,
      { maxBuffer: MAX_BUFFER_BYTES, timeout: DEFAULT_TIMEOUT_MS },
      (error, stdout, stderr) => {
        if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          resolve({ stdout: "", stderr: "ENOENT", exitCode: 127 });
          return;
        }
        const code = error
          ? ((error as Error & { code?: string | number }).code ?? 1)
          : 0;
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: typeof code === "number" ? code : 1,
        });
      },
    );
    if (stdin !== undefined) {
      child.stdin?.end(stdin);
    }
  });

let runner: AcliRunner = defaultRunner;

/**
 * Override the acli runner (tests inject a fake). Pass `null` to restore the
 * real execFile-backed runner.
 */
export function setAcliRunner(next: AcliRunner | null): void {
  runner = next ?? defaultRunner;
}

/**
 * Combine acli's stderr/stdout for error mapping. acli often prints the real
 * failure reason on STDOUT and only a generic "✗ Error: command execution
 * failed" on stderr (verified against v1.3.22, e.g. board view of a missing
 * ID) — prefer stdout whenever stderr carries just that generic line.
 */
function errorText(result: ExecResult): string {
  const stderr = result.stderr.trim();
  const stdout = result.stdout.trim();
  if (stderr && /command execution failed/i.test(stderr) && stdout) {
    return stdout;
  }
  return stderr || stdout;
}

/** Run acli and return raw result, throwing only when the binary is missing. */
export async function acliRaw(
  args: string[],
  stdin?: string,
): Promise<ExecResult> {
  const result = await runner(args, stdin);
  if (result.stderr === "ENOENT") {
    throw acliNotInstalledError();
  }
  return result;
}

/** Run acli, returning stdout; throw a mapped AxiError on non-zero exit. */
export async function acliExec(
  args: string[],
  stdin?: string,
): Promise<string> {
  const result = await acliRaw(args, stdin);
  if (result.exitCode !== 0) {
    throw mapError(errorText(result), result.exitCode);
  }
  return result.stdout;
}

/** Run acli and parse stdout as JSON; throw on non-zero exit or bad JSON. */
export async function acliJson<T = unknown>(
  args: string[],
  stdin?: string,
): Promise<T> {
  const stdout = await acliExec(args, stdin);
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new AxiError(
      `Unexpected acli output: ${stdout.slice(0, 200)}`,
      "UNKNOWN",
    );
  }
}

/**
 * Detect acli presence + version. Returns the version string (e.g.
 * "1.3.22-stable") or null when acli is not installed. Never throws — callers
 * (like the home dashboard) treat null as "acli not installed".
 */
export async function acliVersion(): Promise<string | null> {
  let result: ExecResult;
  try {
    result = await runner(["--version"]);
  } catch {
    return null;
  }
  if (result.stderr === "ENOENT" || result.exitCode !== 0) {
    return null;
  }
  // acli prints e.g. "acli version 1.3.22-stable".
  const match = result.stdout.match(/version\s+(\S+)/i);
  return match ? match[1] : result.stdout.trim() || null;
}

/** Whether the acli binary is available on PATH. */
export async function acliInstalled(): Promise<boolean> {
  return (await acliVersion()) !== null;
}
