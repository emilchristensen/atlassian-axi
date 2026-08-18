import { execFileSync } from "node:child_process";

export interface RunResult {
  readonly command: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// Runs a command without a shell, never throws; the benchmark records
// failures (nonzero exits) as data rather than aborting.
export function run(bin: string, args: readonly string[]): RunResult {
  const command = [bin, ...args].join(" ");
  try {
    const stdout = execFileSync(bin, [...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });
    return { command, stdout, stderr: "", exitCode: 0 };
  } catch (error) {
    const e = error as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      status?: number | null;
      message?: string;
    };
    return {
      command,
      stdout: typeof e.stdout === "string" ? e.stdout : (e.stdout?.toString() ?? ""),
      stderr: typeof e.stderr === "string" ? e.stderr : (e.stderr?.toString() ?? e.message ?? ""),
      exitCode: e.status ?? 1,
    };
  }
}
