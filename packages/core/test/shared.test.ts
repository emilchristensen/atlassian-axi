import { describe, expect, it } from "vitest";
import { splitFields } from "../src/shared.js";

/**
 * splitFields is the shared parser behind both CLIs' `--fields` escape hatch
 * (jira-axi workitem/sprint, confluence-axi search/space list), so it lives in
 * core and is tested here once.
 */
describe("splitFields", () => {
  it("returns undefined when the flag was not passed", () => {
    expect(splitFields(undefined)).toBeUndefined();
  });

  it("splits and trims a comma-separated list", () => {
    expect(splitFields("id, title ,space")).toEqual(["id", "title", "space"]);
  });

  it("de-duplicates repeated names", () => {
    expect(splitFields("id,title,id")).toEqual(["id", "title"]);
  });

  it("rejects a degenerate list instead of silently using the defaults", () => {
    // Falling back to the default schema would contradict what was asked for.
    for (const raw of ["", ",", "id,", " , "]) {
      expect(() => splitFields(raw)).toThrowError(/Invalid --fields value/);
    }
  });
});
