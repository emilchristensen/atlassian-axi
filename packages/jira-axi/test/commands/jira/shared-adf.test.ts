import { describe, expect, it } from "vitest";
import {
  stripControlChars,
  textOf,
} from "../../../src/commands/jira/shared.js";

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

describe("textOf structural dedupe vs literal content (2026-07-19)", () => {
  it("preserves blank lines inside a codeBlock text node", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          content: [{ type: "text", text: "function a() {}\n\nfunction b() {}" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "after" }] },
      ],
    };
    expect(textOf(adf)).toBe("function a() {}\n\nfunction b() {}\nafter\n");
  });

  it("collapses the 3-stack of terminators from a nested list", () => {
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
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "nested" }],
                        },
                      ],
                    },
                  ],
                },
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
    expect(textOf(adf)).toBe("one\nnested\ntwo\n");
  });
});

describe("stripControlChars C1/DEL neutralization (review finding F6)", () => {
  // U+009B is the 8-bit CSI, U+007F is DEL; TOON leaves the C1 range + DEL
  // through, so strip them upstream (mirrors confluence-axi's strip).
  const csi = "\u009b";
  const del = "\u007f";

  it("strips the C1 range and DEL, keeping the real text", () => {
    expect(stripControlChars(`Rele${csi}ase`)).toBe("Release");
    expect(stripControlChars(`a${csi}b${del}c`)).toBe("abc");
    expect(stripControlChars("\u0080\u008f\u009f\u007f")).toBe("");
  });

  it("leaves C0 controls to TOON's own escaping", () => {
    // C0 (incl. ESC/newline/tab) is escaped by TOON, so this strip must not
    // touch it — the ADF flattener relies on newlines surviving.
    expect(stripControlChars("a\nb\tcd")).toBe("a\nb\tcd");
  });

  it("flattens a crafted ADF description with C1/DEL removed", () => {
    const adf = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: `hel${csi}lo${del} world` }],
        },
      ],
    };
    const out = textOf(adf);
    expect(out).not.toContain(csi);
    expect(out).not.toContain(del);
    expect(out).toBe("hello world\n");
  });

  it("strips C1/DEL from a plain-string body passthrough", () => {
    expect(textOf(`summary${csi}with${del}controls`)).toBe(
      "summarywithcontrols",
    );
  });
});
