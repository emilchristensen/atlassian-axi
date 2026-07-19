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
    expect(exitCodeForError(err)).toBe(2);
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

  it("maps acli's agile/filter not-found phrasings to NOT_FOUND (bare ✗ stripped)", () => {
    // Captured live from acli v1.3.22: these arrive on STDOUT with a bare
    // "✗ " prefix and no "Error:" decoration.
    const board = mapError(
      "✗ The requested board cannot be viewed because it either does not exist or you do not have permission to view it.",
    );
    expect(board.code).toBe("NOT_FOUND");
    expect(board.message.startsWith("The requested board")).toBe(true);
    expect(mapError("✗ We could not find the sprint").code).toBe("NOT_FOUND");
    expect(
      mapError(
        "✗ The selected filter is not available to you, perhaps it has been deleted or had its permissions changed.",
      ).code,
    ).toBe("NOT_FOUND");
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

describe("acli error mapping (2026-07-19 live phrasings)", () => {
  it("maps a JQL parse failure to VALIDATION_ERROR, not NOT_FOUND", () => {
    const err = mapError(
      "✗ Error: failed to parse JQL query: field 'this' does not exist or you do not have permission to view it.",
    );
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).not.toContain("✗");
    expect(err.suggestions.length).toBeGreaterThan(0);
  });

  it("maps 'No project could be found' to NOT_FOUND without the acli glyph", () => {
    const err = mapError("✗ Error: No project could be found with key 'NOPE'.");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("No project could be found with key 'NOPE'.");
  });

  it("maps 'does not support sprints' to VALIDATION_ERROR with a board hint", () => {
    const err = mapError("✗ The board does not support sprints");
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toBe("The board does not support sprints");
    expect(err.suggestions.join(" ")).toContain("board view");
  });

  it("strips the acli glyph on the UNKNOWN fallback too", () => {
    const err = mapError("✗ Error: something entirely novel happened");
    expect(err.code).toBe("UNKNOWN");
    expect(err.message).toBe("something entirely novel happened");
  });
});

describe("confluenceHttpError detail cleaning (2026-07-19)", () => {
  it("strips the Java exception class prefix from v1 error messages", async () => {
    const { confluenceHttpError } = await import("../src/errors.js");
    const err = confluenceHttpError(
      400,
      JSON.stringify({
        statusCode: 400,
        message:
          "com.atlassian.confluence.api.service.exceptions.BadRequestException: Could not parse cql : ",
      }),
    );
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toBe("Could not parse cql :");
    expect(err.message).not.toContain("com.atlassian");
  });

  it("adds a CQL syntax suggestion on CQL 400s", async () => {
    const { confluenceHttpError } = await import("../src/errors.js");
    const err = confluenceHttpError(
      400,
      JSON.stringify({ message: "Exception: Could not parse cql : boom" }),
    );
    expect(err.suggestions.join(" ")).toContain("CQL syntax");
  });

  it("leaves non-CQL 400s without the CQL hint", async () => {
    const { confluenceHttpError } = await import("../src/errors.js");
    const err = confluenceHttpError(
      400,
      JSON.stringify({ message: "Something else went wrong" }),
    );
    expect(err.suggestions).toEqual([]);
  });
});
