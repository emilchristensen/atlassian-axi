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

  it("maps acli unauthorized stderr to AUTH_REQUIRED with a login suggestion", () => {
    const err = mapError(
      "✗ Error: unauthorized: use 'acli jira auth login' to authenticate",
      1,
    );
    expect(err.code).toBe("AUTH_REQUIRED");
    // The "✗ Error: " decoration is stripped for token-lean output.
    expect(err.message).toBe(
      "unauthorized: use 'acli jira auth login' to authenticate",
    );
    expect(err.suggestions.join(" ")).toContain("auth login");
  });

  it("maps not-found, forbidden, rate-limit and invalid stderr to typed codes", () => {
    expect(mapError("✗ Error: work item TEAM-9 not found").code).toBe(
      "NOT_FOUND",
    );
    expect(mapError("Error: forbidden").code).toBe("FORBIDDEN");
    expect(mapError("rate limit exceeded, try again later").code).toBe(
      "RATE_LIMITED",
    );
    expect(mapError("✗ Error: error in the JQL Query").code).toBe(
      "VALIDATION_ERROR",
    );
    expect(
      mapError(
        "✗ Error: Unbounded JQL queries are not allowed here. Please add a search restriction to your query.",
      ).code,
    ).toBe("VALIDATION_ERROR");
  });

  it("mapError falls back to the first line as UNKNOWN when nothing matches", () => {
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
