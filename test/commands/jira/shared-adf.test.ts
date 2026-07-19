import { describe, expect, it } from "vitest";
import { textOf } from "../../../src/commands/jira/shared.js";

describe("textOf ADF flattening", () => {
  it("separates a code block from the following paragraph", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          content: [{ type: "text", text: "const x = 42;" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Link to Atlassian" }],
        },
      ],
    };
    // Regression: rendered as "const x = 42;Link to Atlassian" (sweep 2026-07-19).
    expect(textOf(adf)).toBe("const x = 42;\nLink to Atlassian\n");
  });

  it("separates list items without doubling newlines", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "one" }] },
              ],
            },
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "two" }] },
              ],
            },
          ],
        },
      ],
    };
    expect(textOf(adf)).toBe("one\ntwo\n");
  });
});
