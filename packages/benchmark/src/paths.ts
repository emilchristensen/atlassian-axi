import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export const BENCHMARK_ROOT = join(here, "..");
export const REPO_ROOT = join(BENCHMARK_ROOT, "..", "..");

export const JIRA_AXI_BIN = join(REPO_ROOT, "packages/jira-axi/dist/bin/jira-axi.js");
export const CONFLUENCE_AXI_BIN = join(REPO_ROOT, "packages/confluence-axi/dist/bin/confluence-axi.js");
export const JIRA_AXI_SKILL = join(REPO_ROOT, "packages/jira-axi/skills/jira-axi/SKILL.md");
export const CONFLUENCE_AXI_SKILL = join(REPO_ROOT, "packages/confluence-axi/skills/confluence-axi/SKILL.md");

export const DATA_DIR = join(BENCHMARK_ROOT, "data");
export const ARTIFACTS_DIR = join(BENCHMARK_ROOT, "artifacts");
export const FIGURES_DIR = join(ARTIFACTS_DIR, "figures");
export const RAW_DIR = join(ARTIFACTS_DIR, "raw");
