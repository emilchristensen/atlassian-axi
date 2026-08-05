// Renders the curated coverage matrices (data/coverage-*.json) to markdown
// fragments under artifacts/figures/, from which the results document copies
// its tables. Each cell carries its own provenance.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, FIGURES_DIR } from "./paths.js";

interface Cell {
  readonly status: string;
  readonly how: string;
  readonly provenance: string;
}

interface Matrix {
  readonly product: string;
  readonly surfaces: readonly string[];
  readonly acliPageReadOnlyGap?: string;
  readonly provenanceKey: Record<string, string>;
  readonly rows: ReadonlyArray<Record<string, Cell | string>>;
}

mkdirSync(FIGURES_DIR, { recursive: true });

const MARK: Record<string, string> = {
  supported: "supported",
  partial: "partial",
  unsupported: "unsupported",
  "not-established": "not-established",
};

function renderCell(cell: Cell): string {
  const mark = MARK[cell.status] ?? cell.status;
  const prov = cell.provenance === "measured" ? "m" : "d";
  return `${mark} [${prov}] - ${cell.how}`;
}

function renderMatrix(file: string): string {
  const matrix = JSON.parse(readFileSync(join(DATA_DIR, file), "utf8")) as Matrix;
  const lines: string[] = [];
  const [a, b, c] = matrix.surfaces;
  lines.push(`| Operation | ${a} | ${b} | ${c} |`);
  lines.push("|---|---|---|---|");
  for (const row of matrix.rows) {
    const cells = matrix.surfaces.map((s) => renderCell(row[s] as Cell));
    lines.push(`| ${row.operation as string} | ${cells.join(" | ")} |`);
  }
  lines.push("");
  lines.push("Provenance markers: `[m]` = measured, `[d]` = derived-from-docs.");
  for (const [key, value] of Object.entries(matrix.provenanceKey)) {
    lines.push(`- ${key}: ${value}`);
  }
  if (matrix.acliPageReadOnlyGap) {
    lines.push("");
    lines.push(`acli page-read-only gap: ${matrix.acliPageReadOnlyGap}`);
  }
  return lines.join("\n") + "\n";
}

for (const [file, out] of [
  ["coverage-jira.json", "coverage-jira.md"],
  ["coverage-confluence.json", "coverage-confluence.md"],
] as const) {
  writeFileSync(join(FIGURES_DIR, out), renderMatrix(file));
  console.log(`coverage: ${file} -> artifacts/figures/${out}`);
}
