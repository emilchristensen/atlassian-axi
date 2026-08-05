// Runs the representative task set (tasks/tasks.json) on jira-axi,
// confluence-axi, and raw acli, records redacted raw outputs as committed
// artifacts, and counts output tokens. Read tasks run live (read-only).
// Write probes target guaranteed-nonexistent items so nothing can mutate.
// The MCP surface cannot be driven here (interactive OAuth); its cells are
// emitted as not-measured with the documented tool named.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { countTokens, TOKEN_METHOD } from "./tokens.js";
import { run, type RunResult } from "./run.js";
import { redact } from "./redact.js";
import { BENCHMARK_ROOT, CONFLUENCE_AXI_BIN, FIGURES_DIR, JIRA_AXI_BIN, RAW_DIR } from "./paths.js";

interface Task {
  readonly id: string;
  readonly product: "jira" | "confluence";
  readonly title: string;
  readonly kind: "read" | "write-probe";
  readonly commands: Record<string, readonly string[] | null>;
  readonly acliGapProbe?: readonly string[];
  readonly mcp: { readonly tool: string; readonly note: string } | null;
}

interface Row {
  readonly task: string;
  readonly title: string;
  readonly kind: string;
  readonly surface: string;
  readonly command: string | null;
  readonly exitCode: number | null;
  readonly tokens: number | null;
  readonly provenance: string;
  readonly note?: string;
}

const OUTPUT_RAW_DIR = join(RAW_DIR, "outputs");
mkdirSync(OUTPUT_RAW_DIR, { recursive: true });
mkdirSync(FIGURES_DIR, { recursive: true });

const { tasks } = JSON.parse(readFileSync(join(BENCHMARK_ROOT, "tasks/tasks.json"), "utf8")) as {
  tasks: readonly Task[];
};

const rows: Row[] = [];

function displayCommand(surface: string, args: readonly string[]): string {
  if (surface === "acli") return ["acli", ...args].join(" ");
  return [surface, ...args].join(" ");
}

function execute(surface: string, args: readonly string[]): RunResult {
  if (surface === "jira-axi") return run("node", [JIRA_AXI_BIN, ...args]);
  if (surface === "confluence-axi") return run("node", [CONFLUENCE_AXI_BIN, ...args]);
  return run("acli", [...args]);
}

function record(task: Task, surface: string, args: readonly string[], provenance: string, note?: string): void {
  const result = execute(surface, args);
  const combined = redact(result.stdout + (result.stderr ? `\n[stderr]\n${result.stderr}` : ""));
  const header = [
    `# task: ${task.id} ${task.title}`,
    `# surface: ${surface}`,
    `# command: ${redact(displayCommand(surface, args))}`,
    `# exit: ${result.exitCode}`,
    `# provenance: ${provenance}`,
    `# redaction: site/user identifiers replaced per src/redact.ts; token count computed over this redacted text (excluding these header lines)`,
    "",
  ].join("\n");
  writeFileSync(join(OUTPUT_RAW_DIR, `${task.id}-${surface}.txt`), header + combined + "\n");
  rows.push({
    task: task.id,
    title: task.title,
    kind: task.kind,
    surface,
    command: redact(displayCommand(surface, args)),
    exitCode: result.exitCode,
    tokens: countTokens(combined),
    provenance,
    ...(note ? { note } : {}),
  });
}

for (const task of tasks) {
  const provenance = task.kind === "read" ? "measured" : "measured-error-probe (write path never verified live; see derived-from-docs write rows)";
  for (const [surface, args] of Object.entries(task.commands)) {
    if (args === null) {
      if (task.acliGapProbe) {
        record(task, "acli", task.acliGapProbe, "measured-gap-probe (command does not exist; output is the CLI's own error)", "unsupported on this surface");
      } else {
        rows.push({
          task: task.id,
          title: task.title,
          kind: task.kind,
          surface: "acli",
          command: null,
          exitCode: null,
          tokens: null,
          provenance: "not-measured",
          note: "unsupported on this surface",
        });
      }
      continue;
    }
    record(task, surface, args, provenance);
  }
  rows.push({
    task: task.id,
    title: task.title,
    kind: task.kind,
    surface: "mcp",
    command: task.mcp ? `tool: ${task.mcp.tool}` : null,
    exitCode: null,
    tokens: null,
    provenance: "not-measured",
    note: task.mcp
      ? `${task.mcp.note}; server requires interactive OAuth, unauthenticated access returns HTTP 401`
      : "no documented MCP tool covers this operation",
  });
}

const versions = {
  "jira-axi": run("node", [JIRA_AXI_BIN, "--version"]).stdout.trim(),
  "confluence-axi": run("node", [CONFLUENCE_AXI_BIN, "--version"]).stdout.trim(),
  acli: redact(run("acli", ["--version"]).stdout.trim()),
};

writeFileSync(
  join(FIGURES_DIR, "output-cost.json"),
  JSON.stringify({ method: TOKEN_METHOD, versions, rows }, null, 2) + "\n",
);
console.log(`output-cost: ${rows.length} rows -> artifacts/figures/output-cost.json`);
