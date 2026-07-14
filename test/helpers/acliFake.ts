import type { AcliRunner, ExecResult } from "../../src/acli.js";

export interface AcliCall {
  args: string[];
  stdin?: string;
}

export interface AcliRoute {
  match: (args: string[]) => boolean;
  /** JSON payload (stringified into stdout) or a full ExecResult. */
  result: unknown | ExecResult;
}

function isExecResult(value: unknown): value is ExecResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "stdout" in value &&
    "exitCode" in value
  );
}

/**
 * Build a fake acli runner from ordered routes. First matching route wins;
 * an unmatched invocation fails loudly so tests never silently pass on an
 * unexpected shell-out. `--version` always succeeds.
 */
export function makeAcliFake(routes: AcliRoute[]) {
  const calls: AcliCall[] = [];
  const runner: AcliRunner = async (args, stdin) => {
    calls.push({ args, stdin });
    if (args[0] === "--version") {
      return { stdout: "acli version 1.3.22-stable\n", stderr: "", exitCode: 0 };
    }
    for (const route of routes) {
      if (route.match(args)) {
        if (isExecResult(route.result)) {
          return route.result;
        }
        return {
          stdout: JSON.stringify(route.result),
          stderr: "",
          exitCode: 0,
        };
      }
    }
    throw new Error(`Unexpected acli invocation: ${args.join(" ")}`);
  };
  return { runner, calls };
}

export function includesSeq(args: string[], seq: string[]): boolean {
  return seq.every((part) => args.includes(part));
}
