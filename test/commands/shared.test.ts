import { describe, expect, it } from "vitest";
import { parseFlags, parseLimit } from "../../src/commands/shared.js";

describe("parseFlags", () => {
  it("consumes known value/bool flags and returns the positional", () => {
    const args = ["get", "--format", "storage", "12345", "--full"];
    const parsed = parseFlags(args, {
      values: ["--format"],
      bools: ["--full"],
    });
    expect(parsed.values["--format"]).toBe("storage");
    expect(parsed.bools["--full"]).toBe(true);
    expect(parsed.positional).toBe("12345");
    expect(parsed.help).toBe(false);
  });

  it("rejects an unknown (typo'd) flag instead of silently ignoring it", () => {
    // `--formt storage 12345` would otherwise fetch page id "storage".
    expect(() =>
      parseFlags(["get", "--formt", "storage", "12345"], {
        values: ["--format"],
      }),
    ).toThrowError(/Unknown flag: --formt/);
  });

  it("still returns help when --help accompanies an unknown flag", () => {
    const parsed = parseFlags(["get", "--bogus", "--help"], { values: [] });
    expect(parsed.help).toBe(true);
  });
});

describe("parseLimit", () => {
  it("defaults and accepts positive integers", () => {
    expect(parseLimit(undefined)).toBe(30);
    expect(parseLimit("5")).toBe(5);
  });

  it.each(["5abc", "5.9", "-3", "0", "abc", ""])(
    "rejects %j instead of coercing",
    (raw) => {
      expect(() => parseLimit(raw)).toThrowError(/Invalid --limit/);
    },
  );
});
