import { describe, expect, it } from "vitest";
import { AxiError } from "../../src/errors.js";
import { parseFlags, parseLimit } from "../../src/shared.js";

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

  it("lists the accepted flags in the unknown-flag error", () => {
    // Saves the agent a second `--help` round-trip to learn the real name.
    let thrown: unknown;
    try {
      parseFlags(["get", "--formt", "storage", "12345"], {
        values: ["--format"],
        bools: ["--full"],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AxiError);
    const err = thrown as AxiError;
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.suggestions).toContain(
      "Supported flags: --format, --full, --help",
    );
  });

  it("lists caller-consumed flags too, so the list is never a lie", () => {
    // takeBody/stripSite strip their flags before parseFlags runs; the command
    // still accepts them, so the error must not claim it takes none.
    let thrown: unknown;
    try {
      parseFlags(["add", "--bod", "hello"], { consumed: ["--body"] });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as AxiError).suggestions).toContain(
      "Supported flags: --body, --help",
    );
  });

  it("still returns help when --help accompanies an unknown flag", () => {
    const parsed = parseFlags(["get", "--bogus", "--help"], { values: [] });
    expect(parsed.help).toBe(true);
  });

  it("rejects a value flag with a missing value instead of dropping it", () => {
    // `labels 12345 --add` used to silently degrade the mutation to a list.
    expect(() =>
      parseFlags(["labels", "12345", "--add"], { values: ["--add"] }),
    ).toThrowError(/--add requires a value/);
    expect(() =>
      parseFlags(["labels", "12345", "--add=", "x"], { values: ["--add"] }),
    ).not.toThrow(); // --add= is an explicit (empty) value; downstream validates
  });

  it("rejects a value flag that swallowed a sibling flag as its value", () => {
    // `--add --remove` used to POST a label literally named "--remove".
    expect(() =>
      parseFlags(["labels", "12345", "--add", "--remove"], {
        values: ["--add", "--remove"],
      }),
    ).toThrowError(/--add requires a value \(got the flag --remove instead\)/);
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
