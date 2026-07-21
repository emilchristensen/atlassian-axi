import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveSite } from "../src/context.js";

describe("resolveSite", () => {
  const saved = process.env["ATLASSIAN_SITE"];
  beforeEach(() => delete process.env["ATLASSIAN_SITE"]);
  afterEach(() => {
    if (saved === undefined) delete process.env["ATLASSIAN_SITE"];
    else process.env["ATLASSIAN_SITE"] = saved;
  });

  it("prefers the flag value (source=flag)", () => {
    process.env["ATLASSIAN_SITE"] = "env.atlassian.net";
    expect(resolveSite("flag.atlassian.net")).toEqual({
      site: "flag.atlassian.net",
      source: "flag",
    });
  });

  it("trims the flag value", () => {
    expect(resolveSite("  spaced.atlassian.net  ")).toEqual({
      site: "spaced.atlassian.net",
      source: "flag",
    });
  });

  it("falls back to the ATLASSIAN_SITE env var (source=env)", () => {
    process.env["ATLASSIAN_SITE"] = "env.atlassian.net";
    expect(resolveSite()).toEqual({
      site: "env.atlassian.net",
      source: "env",
    });
  });

  it("returns undefined when neither flag nor env is set", () => {
    expect(resolveSite()).toBeUndefined();
    expect(resolveSite("   ")).toBeUndefined();
  });
});
