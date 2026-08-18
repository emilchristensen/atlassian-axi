// Measures the context-window cost of each surface: what an agent must load
// before it can operate the product. Writes artifacts/figures/context-cost.json
// and the raw captured texts under artifacts/raw/help/ for audit.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { countTokens, TOKEN_METHOD } from "./tokens.js";
import { run } from "./run.js";
import {
  CONFLUENCE_AXI_BIN,
  CONFLUENCE_AXI_SKILL,
  DATA_DIR,
  FIGURES_DIR,
  JIRA_AXI_BIN,
  JIRA_AXI_SKILL,
  RAW_DIR,
} from "./paths.js";

interface Component {
  readonly surface: string;
  readonly component: string;
  readonly tokens: number;
  readonly provenance: "measured" | "derived-from-docs";
  readonly source: string;
}

const HELP_RAW_DIR = join(RAW_DIR, "help");
mkdirSync(HELP_RAW_DIR, { recursive: true });
mkdirSync(FIGURES_DIR, { recursive: true });

const components: Component[] = [];

function slugify(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

function captureText(surface: string, component: string, text: string, provenance: Component["provenance"], source: string): void {
  writeFileSync(join(HELP_RAW_DIR, `${slugify(`${surface}-${component}`)}.txt`), text);
  components.push({ surface, component, tokens: countTokens(text), provenance, source });
}

function captureHelp(surface: string, bin: string, binArgs: readonly string[], args: readonly string[]): string {
  const result = run(bin, [...binArgs, ...args, "--help"]);
  const text = result.stdout + result.stderr;
  captureText(surface, [...args, "--help"].join(" ") || "--help", text, "measured", `\`${[surface === "acli-jira" || surface === "acli-confluence" ? "acli" : surface, ...args, "--help"].join(" ")}\` output, captured live`);
  return text;
}

// --- jira-axi ---
captureText("jira-axi", "SKILL.md", readFileSync(JIRA_AXI_SKILL, "utf8"), "measured", "packages/jira-axi/skills/jira-axi/SKILL.md");
captureHelp("jira-axi", "node", [JIRA_AXI_BIN], []);
for (const resource of ["workitem", "project", "board", "sprint", "filter", "dashboard", "field"]) {
  captureHelp("jira-axi", "node", [JIRA_AXI_BIN], [resource]);
}

// --- confluence-axi ---
captureText("confluence-axi", "SKILL.md", readFileSync(CONFLUENCE_AXI_SKILL, "utf8"), "measured", "packages/confluence-axi/skills/confluence-axi/SKILL.md");
captureHelp("confluence-axi", "node", [CONFLUENCE_AXI_BIN], []);
for (const resource of ["page", "space", "search", "auth"]) {
  captureHelp("confluence-axi", "node", [CONFLUENCE_AXI_BIN], [resource]);
}

// --- raw acli, Jira side ---
captureHelp("acli-jira", "acli", [], []);
captureHelp("acli-jira", "acli", [], ["jira"]);
for (const args of [
  ["jira", "workitem"],
  ["jira", "workitem", "view"],
  ["jira", "workitem", "search"],
  ["jira", "workitem", "transition"],
  ["jira", "workitem", "comment"],
  ["jira", "workitem", "comment", "list"],
  ["jira", "workitem", "comment", "create"],
]) {
  captureHelp("acli-jira", "acli", [], args);
}

// --- raw acli, Confluence side ---
captureHelp("acli-confluence", "acli", [], ["confluence"]);
for (const args of [
  ["confluence", "page"],
  ["confluence", "page", "view"],
  ["confluence", "space"],
  ["confluence", "space", "list"],
  ["confluence", "blog"],
]) {
  captureHelp("acli-confluence", "acli", [], args);
}

// --- MCP (derived-from-docs lower bound) ---
interface McpTool {
  readonly name: string;
  readonly description: string;
}
interface McpDoc {
  readonly source: string;
  readonly schemaNote: string;
  readonly common: readonly McpTool[];
  readonly jira: readonly McpTool[];
  readonly confluence: readonly McpTool[];
  readonly platform: readonly McpTool[];
}
const mcp = JSON.parse(readFileSync(join(DATA_DIR, "mcp-tools.json"), "utf8")) as McpDoc;

function mcpToolText(tools: readonly McpTool[]): string {
  return JSON.stringify(
    tools.map((t) => ({ name: t.name, description: t.description })),
    null,
    2,
  );
}

const mcpSource = `${mcp.source} (names + descriptions only; inputSchema JSON is not published, so this is a lower bound)`;
captureText("mcp", "common tool defs (names+descriptions)", mcpToolText(mcp.common), "derived-from-docs", mcpSource);
captureText("mcp", "jira tool defs (names+descriptions)", mcpToolText(mcp.jira), "derived-from-docs", mcpSource);
captureText("mcp", "confluence tool defs (names+descriptions)", mcpToolText(mcp.confluence), "derived-from-docs", mcpSource);
captureText("mcp", "platform search tool defs (names+descriptions)", mcpToolText(mcp.platform), "derived-from-docs", mcpSource);

// --- scenario compositions the results document reports ---
function total(surface: string, names: readonly string[]): number {
  return components
    .filter((c) => c.surface === surface && names.includes(c.component))
    .reduce((sum, c) => sum + c.tokens, 0);
}

const scenarios = [
  {
    scenario: "Entry cost: what the surface loads before the first operation",
    description:
      "axi CLIs: the skill file an agent harness loads. acli: top-level + product help (no skill exists). MCP: every in-scope tool definition, injected whether or not it is used (lower bound; real inputSchema JSON is not published).",
    rows: [
      { surface: "jira-axi", tokens: total("jira-axi", ["SKILL.md"]), provenance: "measured" },
      { surface: "acli (jira)", tokens: total("acli-jira", ["--help", "jira --help"]), provenance: "measured" },
      { surface: "MCP (jira, lower bound)", tokens: total("mcp", ["common tool defs (names+descriptions)", "jira tool defs (names+descriptions)"]), provenance: "derived-from-docs" },
      { surface: "confluence-axi", tokens: total("confluence-axi", ["SKILL.md"]), provenance: "measured" },
      { surface: "acli (confluence)", tokens: total("acli-confluence", ["confluence --help"]) + total("acli-jira", ["--help"]), provenance: "measured" },
      { surface: "MCP (confluence, lower bound)", tokens: total("mcp", ["common tool defs (names+descriptions)", "confluence tool defs (names+descriptions)"]), provenance: "derived-from-docs" },
    ],
  },
  {
    scenario: "Task-set discovery cost: help screens needed for the representative tasks",
    description:
      "The per-command help an agent reads to run the representative task set correctly, beyond the entry cost. axi CLIs: the skill already carries per-command usage, so this is optional; measured here as the resource helps the task set touches. acli: the subcommand help screens for the same tasks. MCP: zero (schemas already injected at entry).",
    rows: [
      { surface: "jira-axi", tokens: total("jira-axi", ["workitem --help"]), provenance: "measured" },
      {
        surface: "acli (jira)",
        tokens: total("acli-jira", [
          "jira workitem --help",
          "jira workitem view --help",
          "jira workitem search --help",
          "jira workitem transition --help",
          "jira workitem comment --help",
          "jira workitem comment list --help",
          "jira workitem comment create --help",
        ]),
        provenance: "measured",
      },
      { surface: "MCP (jira)", tokens: 0, provenance: "derived-from-docs" },
      { surface: "confluence-axi", tokens: total("confluence-axi", ["page --help", "search --help", "space --help"]), provenance: "measured" },
      {
        surface: "acli (confluence)",
        tokens: total("acli-confluence", [
          "confluence page --help",
          "confluence page view --help",
          "confluence space --help",
          "confluence space list --help",
        ]),
        provenance: "measured",
      },
      { surface: "MCP (confluence)", tokens: 0, provenance: "derived-from-docs" },
    ],
  },
];

const figures = {
  method: TOKEN_METHOD,
  note: "All figures are token counts over the exact texts committed under artifacts/raw/help/.",
  schemaNote: mcp.schemaNote,
  components,
  scenarios,
};

writeFileSync(join(FIGURES_DIR, "context-cost.json"), JSON.stringify(figures, null, 2) + "\n");
console.log(`context-cost: ${components.length} components measured -> artifacts/figures/context-cost.json`);
