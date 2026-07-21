import { describe, expect, it } from "vitest";
import {
  closestCommand,
  getSuggestions,
  type SuggestionContext,
} from "../src/suggestions.js";

/**
 * Suggestions parity: every {domain, action, isEmpty} combination a command
 * actually renders must resolve to at least one next-step line — an empty
 * help block is a dead-end for the agent driving the CLI. Keep this list in
 * sync with the getSuggestions() call sites under src/commands/.
 */
const RENDERED_CONTEXTS: SuggestionContext[] = [
  { domain: "home", action: "home" },

  // jira workitem
  { domain: "workitem", action: "list", isEmpty: false },
  { domain: "workitem", action: "list", isEmpty: true },
  { domain: "workitem", action: "search", isEmpty: false },
  { domain: "workitem", action: "search", isEmpty: true },
  { domain: "workitem", action: "view", id: "TEAM-1" },
  { domain: "workitem", action: "create", id: "TEAM-1" },
  { domain: "workitem", action: "edit", id: "TEAM-1" },
  { domain: "workitem", action: "assign", id: "TEAM-1" },
  { domain: "workitem", action: "transition", id: "TEAM-1" },
  { domain: "workitem", action: "comment", id: "TEAM-1" },

  // jira project
  { domain: "project", action: "list", isEmpty: false },
  { domain: "project", action: "list", isEmpty: true },
  { domain: "project", action: "view", id: "TEAM" },

  // jira board
  { domain: "board", action: "list", isEmpty: false },
  { domain: "board", action: "list", isEmpty: true },
  { domain: "board", action: "view", id: 7 },
  { domain: "board", action: "list-sprints", id: 7, isEmpty: false },
  { domain: "board", action: "list-sprints", id: 7, isEmpty: true },
  { domain: "board", action: "list-projects", id: 7 },

  // jira sprint
  { domain: "sprint", action: "view", id: 42 },
  { domain: "sprint", action: "list-workitems", id: 42, isEmpty: false },
  { domain: "sprint", action: "list-workitems", id: 42, isEmpty: true },
  { domain: "sprint", action: "create", id: 42 },
  { domain: "sprint", action: "create" },
  { domain: "sprint", action: "update", id: 42 },

  // jira filter
  { domain: "filter", action: "list", isEmpty: false },
  { domain: "filter", action: "list", isEmpty: true },
  { domain: "filter", action: "search", isEmpty: false },
  { domain: "filter", action: "search", isEmpty: true },
  { domain: "filter", action: "view", id: 9 },
  { domain: "filter", action: "update", id: 9 },

  // jira dashboard
  { domain: "dashboard", action: "list", isEmpty: false },
  { domain: "dashboard", action: "list", isEmpty: true },

  // jira field
  { domain: "field", action: "create", id: "customfield_1" },
  { domain: "field", action: "update", id: "customfield_1" },
  { domain: "field", action: "delete", id: "customfield_1" },
  { domain: "field", action: "restore", id: "customfield_1" },

  // confluence page
  { domain: "page", action: "get", id: "12345" },
  { domain: "page", action: "create", id: "12345" },
  { domain: "page", action: "update", id: "12345" },
  { domain: "page", action: "delete", id: "12345" },
  { domain: "page", action: "attachments", id: "12345", isEmpty: false },
  { domain: "page", action: "attachments", id: "12345", isEmpty: true },
  {
    domain: "page",
    action: "attachments",
    id: "12345",
    isEmpty: true,
    state: "filtered",
  },
  { domain: "page", action: "labels", id: "12345", isEmpty: false },
  { domain: "page", action: "labels", id: "12345", isEmpty: true },
  { domain: "page", action: "labels-add", id: "12345", isEmpty: false },
  { domain: "page", action: "labels-add", id: "12345", isEmpty: true },
  { domain: "page", action: "labels-remove", id: "12345", isEmpty: false },
  { domain: "page", action: "labels-remove", id: "12345", isEmpty: true },
  { domain: "page", action: "children", id: "12345", isEmpty: false },
  { domain: "page", action: "children", id: "12345", isEmpty: true },

  // confluence space / search
  { domain: "space", action: "list", isEmpty: false },
  { domain: "space", action: "list", isEmpty: true },
  { domain: "confluence-search", action: "search", isEmpty: false },
  { domain: "confluence-search", action: "search", isEmpty: true },
];

describe("suggestions parity", () => {
  it.each(
    RENDERED_CONTEXTS.map((ctx) => [
      `${ctx.domain}/${ctx.action}${ctx.isEmpty === undefined ? "" : ctx.isEmpty ? " (empty)" : " (non-empty)"}${"id" in ctx ? "" : " (no id)"}`,
      ctx,
    ]),
  )("%s has at least one suggestion", (_name, ctx) => {
    const lines = getSuggestions(ctx as SuggestionContext);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/atlassian-axi|Broaden|Narrow|Try /);
    }
  });

  it("substitutes the entity id into id-bearing suggestions", () => {
    const lines = getSuggestions({
      domain: "page",
      action: "children",
      id: "999",
      isEmpty: true,
    });
    expect(lines[0]).toContain("--parent 999");
  });

  it("appends --site to every command when the site came from a flag", () => {
    const flagged = getSuggestions({
      domain: "page",
      action: "labels",
      id: "12345",
      isEmpty: false,
      site: { site: "other.atlassian.net", source: "flag" },
    });
    for (const line of flagged) {
      expect(line).toContain(" --site other.atlassian.net`");
    }

    const fromEnv = getSuggestions({
      domain: "page",
      action: "labels",
      id: "12345",
      isEmpty: false,
      site: { site: "other.atlassian.net", source: "env" },
    });
    for (const line of fromEnv) {
      expect(line).not.toContain("--site");
    }
  });
});

describe("closestCommand", () => {
  const KNOWN = ["auth", "jira", "confluence", "setup", "update"] as const;

  it("accepts a typo at distance exactly 2 when the input is long enough", () => {
    // "setpu" -> "setup" is a transposition (Levenshtein distance 2);
    // length 5 scales the threshold up to 2.
    expect(closestCommand("setpu", KNOWN)).toBe("setup");
  });

  it("rejects a candidate at distance 3", () => {
    // Three substitutions; long enough input that the threshold is at its
    // maximum of 2, so this probes the boundary itself.
    expect(closestCommand("abcdef", ["abcxyz"])).toBeUndefined();
  });

  it("gives no hint for short unrelated input (length-scaled threshold)", () => {
    // Flat distance <= 2 would match these; the scaled threshold must not.
    expect(closestCommand("at", KNOWN)).toBeUndefined();
    expect(closestCommand("jr", KNOWN)).toBeUndefined();
  });

  it("still hints on a close short typo", () => {
    expect(closestCommand("jra", KNOWN)).toBe("jira");
  });

  it("breaks ties by first candidate in the known list", () => {
    expect(closestCommand("bath", ["math", "path"])).toBe("math");
  });

  it("matches case-insensitively on both sides", () => {
    expect(closestCommand("JIRA", KNOWN)).toBe("jira");
    expect(closestCommand("jira", ["JIRA"])).toBe("JIRA");
  });
});
