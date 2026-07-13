import { describe, expect, it } from "vitest";
import {
  AxiError,
  acliNotInstalledError,
  exitCodeForError,
  mapError,
} from "../src/errors.js";

describe("errors", () => {
  it("re-exports the SDK AxiError and exitCodeForError", () => {
    const err = new AxiError("nope", "VALIDATION_ERROR", ["fix it"]);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.suggestions).toEqual(["fix it"]);
    expect(typeof exitCodeForError(err)).toBe("number");
  });

  it("mapError falls back to the first line as UNKNOWN (empty pattern map in Phase 0)", () => {
    const err = mapError("something broke\nmore detail", 3);
    expect(err).toBeInstanceOf(AxiError);
    expect(err.code).toBe("UNKNOWN");
    expect(err.message).toBe("something broke");
  });

  it("mapError falls back to the exit code when the raw text is empty", () => {
    const err = mapError("   ", 42);
    expect(err.message).toContain("42");
    expect(err.code).toBe("UNKNOWN");
  });

  it("acliNotInstalledError carries an install suggestion", () => {
    const err = acliNotInstalledError();
    expect(err.code).toBe("ACLI_NOT_INSTALLED");
    expect(err.suggestions.join(" ")).toContain("brew install acli");
  });
});
