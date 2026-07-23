import { describe, expect, it } from "vitest";
import {
  appendSiteFlag,
  appendSiteFlagToLines,
  closestCommand,
  matchSuggestions,
  type SuggestionEntry,
} from "../src/suggestions.js";

/**
 * These exercise the domain-agnostic ENGINE only. Each CLI package (jira-axi /
 * confluence-axi) owns and tests its own domain suggestion table; here we drive
 * `matchSuggestions` with a tiny fake table for a fictional `demo-axi` bin.
 */
const DEMO_TABLE: readonly SuggestionEntry[] = [
  // Empty-state list: gated on isEmpty === true, wins over the generic list
  // entry below because it comes first.
  {
    match: (ctx) =>
      ctx.domain === "item" && ctx.action === "list" && ctx.isEmpty === true,
    lines: () => ["Broaden the query: `demo-axi list --all`"],
  },
  // Generic (non-empty) list.
  {
    match: (ctx) => ctx.domain === "item" && ctx.action === "list",
    lines: () => ["Narrow it down: `demo-axi list --mine`"],
  },
  // Id-bearing view: substitutes the entity id.
  {
    match: (ctx) => ctx.domain === "item" && ctx.action === "view",
    lines: (ctx) => [
      `Edit it: \`demo-axi edit ${ctx.id}\``,
      "See docs at https://example.test",
    ],
  },
  // A "filtered" empty state gated on the state field.
  {
    match: (ctx) =>
      ctx.domain === "item" &&
      ctx.action === "search" &&
      ctx.state === "filtered",
    lines: () => ["Try `demo-axi search --clear-filters`"],
  },
];

const BIN = "demo-axi";

describe("matchSuggestions", () => {
  it("returns the first matching entry's lines (first-match-wins)", () => {
    const lines = matchSuggestions(
      DEMO_TABLE,
      { domain: "item", action: "list", isEmpty: true },
      BIN,
    );
    expect(lines).toEqual(["Broaden the query: `demo-axi list --all`"]);
  });

  it("falls through to the generic entry when the empty-state gate fails", () => {
    const lines = matchSuggestions(
      DEMO_TABLE,
      { domain: "item", action: "list", isEmpty: false },
      BIN,
    );
    expect(lines).toEqual(["Narrow it down: `demo-axi list --mine`"]);
  });

  it("gates on the state field", () => {
    const matched = matchSuggestions(
      DEMO_TABLE,
      { domain: "item", action: "search", state: "filtered" },
      BIN,
    );
    expect(matched).toEqual(["Try `demo-axi search --clear-filters`"]);

    const unmatched = matchSuggestions(
      DEMO_TABLE,
      { domain: "item", action: "search" },
      BIN,
    );
    expect(unmatched).toEqual([]);
  });

  it("returns an empty array when no entry matches", () => {
    expect(
      matchSuggestions(DEMO_TABLE, { domain: "nope", action: "nope" }, BIN),
    ).toEqual([]);
  });

  it("substitutes the entity id into id-bearing suggestions", () => {
    const lines = matchSuggestions(
      DEMO_TABLE,
      { domain: "item", action: "view", id: "ITEM-42" },
      BIN,
    );
    expect(lines[0]).toContain("edit ITEM-42");
  });

  it("appends --site to command lines mentioning the bin when the site came from a flag", () => {
    const flagged = matchSuggestions(
      DEMO_TABLE,
      {
        domain: "item",
        action: "view",
        id: "ITEM-42",
        site: { site: "other.atlassian.net", source: "flag" },
      },
      BIN,
    );
    // Line that mentions the bin gets the flag appended inside the backticks.
    expect(flagged[0]).toContain("edit ITEM-42 --site other.atlassian.net`");
    // Line that does NOT mention the bin is left untouched.
    expect(flagged[1]).toBe("See docs at https://example.test");
  });

  it("keeps $-sequences in the site value literal (no replacement-pattern injection)", () => {
    // A `$1`/`$&`-bearing site value would corrupt the suggestion line if the
    // flag were spliced in as a String.replace replacement string; the
    // function-based replace keeps it literal.
    const lines = matchSuggestions(
      DEMO_TABLE,
      {
        domain: "item",
        action: "view",
        id: "ITEM-42",
        site: { site: "a$1$&b.atlassian.net", source: "flag" },
      },
      BIN,
    );
    expect(lines[0]).toContain("--site a$1$&b.atlassian.net`");
  });

  it("does not append --site when the site came from a non-flag source", () => {
    const fromEnv = matchSuggestions(
      DEMO_TABLE,
      {
        domain: "item",
        action: "view",
        id: "ITEM-42",
        site: { site: "other.atlassian.net", source: "env" },
      },
      BIN,
    );
    for (const line of fromEnv) {
      expect(line).not.toContain("--site");
    }
  });

  it("does not append --site when there is no site context", () => {
    const plain = matchSuggestions(
      DEMO_TABLE,
      { domain: "item", action: "view", id: "ITEM-42" },
      BIN,
    );
    for (const line of plain) {
      expect(line).not.toContain("--site");
    }
  });
});

describe("appendSiteFlag", () => {
  const FLAG_SITE = { site: "other.atlassian.net", source: "flag" } as const;

  it("appends the flag inside the backticks of a bin-mentioning command", () => {
    expect(appendSiteFlag("Run `demo-axi list`", FLAG_SITE, BIN)).toBe(
      "Run `demo-axi list --site other.atlassian.net`",
    );
  });

  it("leaves exempt commands alone (they reject --site)", () => {
    // A suggested `demo-axi auth status --site x` would fail with "unexpected
    // arguments" — the CLI never strips --site for those commands.
    const line = appendSiteFlag("Run `demo-axi auth status`", FLAG_SITE, BIN, {
      exemptCommands: ["auth"],
    });
    expect(line).toBe("Run `demo-axi auth status`");
  });

  it("still flags a non-exempt command in the same line set", () => {
    const lines = appendSiteFlagToLines(
      ["Run `demo-axi auth status`", "Run `demo-axi list`"],
      FLAG_SITE,
      BIN,
      { exemptCommands: ["auth"] },
    );
    expect(lines).toEqual([
      "Run `demo-axi auth status`",
      "Run `demo-axi list --site other.atlassian.net`",
    ]);
  });

  it("does nothing without a flag-sourced site", () => {
    expect(appendSiteFlag("Run `demo-axi list`", undefined, BIN)).toBe(
      "Run `demo-axi list`",
    );
    expect(
      appendSiteFlag(
        "Run `demo-axi list`",
        { site: "env.atlassian.net", source: "env" },
        BIN,
      ),
    ).toBe("Run `demo-axi list`");
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
