import { describe, expect, it } from "vitest";
import { AxiError, exitCodeForError } from "../src/errors.js";

describe("errors", () => {
  it("re-exports the SDK AxiError and exitCodeForError", () => {
    const err = new AxiError("nope", "VALIDATION_ERROR", ["fix it"]);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.suggestions).toEqual(["fix it"]);
    expect(exitCodeForError(err)).toBe(2);
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
