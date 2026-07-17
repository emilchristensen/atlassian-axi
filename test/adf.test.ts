import { describe, expect, it } from "vitest";
import {
  bodyToAdf,
  isAdfDoc,
  markdownToAdf,
  parseInline,
  type AdfNode,
} from "../src/adf.js";

/** Collect the top-level node types of a doc, in order. */
function topTypes(md: string): string[] {
  return markdownToAdf(md).content.map((n) => n.type);
}

/** Flatten all node types anywhere in the tree (depth-first). */
function allTypes(node: AdfNode): string[] {
  const out = [node.type];
  for (const child of node.content ?? []) out.push(...allTypes(child));
  return out;
}

describe("markdownToAdf - block elements", () => {
  it("produces a valid doc envelope", () => {
    const doc = markdownToAdf("hello");
    expect(doc.type).toBe("doc");
    expect(doc.version).toBe(1);
    expect(Array.isArray(doc.content)).toBe(true);
  });

  it("converts ATX headings with the right level", () => {
    const doc = markdownToAdf("# Title\n\n### Sub");
    expect(doc.content[0]).toMatchObject({
      type: "heading",
      attrs: { level: 1 },
    });
    expect(doc.content[0].content?.[0]).toMatchObject({
      type: "text",
      text: "Title",
    });
    expect(doc.content[1]).toMatchObject({
      type: "heading",
      attrs: { level: 3 },
    });
  });

  it("converts unordered lists to bulletList/listItem/paragraph", () => {
    const doc = markdownToAdf("- one\n- two");
    const list = doc.content[0];
    expect(list.type).toBe("bulletList");
    expect(list.content).toHaveLength(2);
    expect(list.content?.[0]).toMatchObject({
      type: "listItem",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "one" }] },
      ],
    });
  });

  it("converts ordered lists with an order attr", () => {
    const doc = markdownToAdf("1. first\n2. second");
    const list = doc.content[0];
    expect(list.type).toBe("orderedList");
    expect(list.attrs).toEqual({ order: 1 });
    expect(list.content).toHaveLength(2);
  });

  it("preserves a non-1 starting order", () => {
    const doc = markdownToAdf("3. third\n4. fourth");
    expect(doc.content[0]).toMatchObject({
      type: "orderedList",
      attrs: { order: 3 },
    });
  });

  it("nests a deeper-indented list under the item above it", () => {
    const doc = markdownToAdf("- parent\n  - child\n  - child2\n- sibling");
    const list = doc.content[0];
    expect(list.type).toBe("bulletList");
    expect(list.content).toHaveLength(2); // parent + sibling
    const parent = list.content![0];
    // parent listItem holds its paragraph + a nested bulletList
    expect(parent.content?.[0].type).toBe("paragraph");
    expect(parent.content?.[1].type).toBe("bulletList");
    expect(parent.content?.[1].content).toHaveLength(2);
  });

  it("keeps an ordered list separate from a following unordered list", () => {
    expect(topTypes("1. a\n2. b\n\n- c\n- d")).toEqual([
      "orderedList",
      "bulletList",
    ]);
  });

  it("converts fenced code blocks with a language", () => {
    const doc = markdownToAdf("```ts\nconst x = 1;\nconst y = 2;\n```");
    expect(doc.content[0]).toEqual({
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [{ type: "text", text: "const x = 1;\nconst y = 2;" }],
    });
  });

  it("converts fenced code blocks without a language", () => {
    const doc = markdownToAdf("```\nplain\n```");
    expect(doc.content[0]).toEqual({
      type: "codeBlock",
      content: [{ type: "text", text: "plain" }],
    });
  });

  it("does not interpret markdown inside code blocks", () => {
    const doc = markdownToAdf("```\n## not a heading\n- not a list\n```");
    expect(doc.content[0].content?.[0].text).toBe(
      "## not a heading\n- not a list",
    );
  });

  it("wraps plain prose in a paragraph", () => {
    const doc = markdownToAdf("Just some plain text.");
    expect(doc.content[0]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "Just some plain text." }],
    });
  });

  it("joins multi-line paragraphs with hardBreaks", () => {
    const doc = markdownToAdf("line one\nline two");
    const types = (doc.content[0].content ?? []).map((n) => n.type);
    expect(types).toEqual(["text", "hardBreak", "text"]);
  });

  it("handles a mixed document end to end", () => {
    const md = [
      "## Background",
      "",
      "Some intro with a `token`.",
      "",
      "- bullet a",
      "- bullet b",
      "",
      "1. step one",
      "2. step two",
      "",
      "```js",
      "run();",
      "```",
    ].join("\n");
    expect(topTypes(md)).toEqual([
      "heading",
      "paragraph",
      "bulletList",
      "orderedList",
      "codeBlock",
    ]);
  });
});

describe("parseInline - marks", () => {
  it("bold with **", () => {
    expect(parseInline("a **b** c")).toEqual([
      { type: "text", text: "a " },
      { type: "text", text: "b", marks: [{ type: "strong" }] },
      { type: "text", text: " c" },
    ]);
  });

  it("italic with *", () => {
    expect(parseInline("a *b* c")).toEqual([
      { type: "text", text: "a " },
      { type: "text", text: "b", marks: [{ type: "em" }] },
      { type: "text", text: " c" },
    ]);
  });

  it("italic with _ but not inside snake_case words", () => {
    expect(parseInline("_yes_")).toEqual([
      { type: "text", text: "yes", marks: [{ type: "em" }] },
    ]);
    expect(parseInline("snake_case_word")).toEqual([
      { type: "text", text: "snake_case_word" },
    ]);
  });

  it("inline code", () => {
    expect(parseInline("run `npm test` now")).toEqual([
      { type: "text", text: "run " },
      { type: "text", text: "npm test", marks: [{ type: "code" }] },
      { type: "text", text: " now" },
    ]);
  });

  it("does not parse markdown inside inline code", () => {
    expect(parseInline("`**not bold**`")).toEqual([
      { type: "text", text: "**not bold**", marks: [{ type: "code" }] },
    ]);
  });

  it("code span with embedded backticks via a longer fence", () => {
    expect(parseInline("`` a`b ``")).toEqual([
      { type: "text", text: "a`b", marks: [{ type: "code" }] },
    ]);
  });

  it("links", () => {
    expect(parseInline("see [docs](https://example.com/x)")).toEqual([
      { type: "text", text: "see " },
      {
        type: "text",
        text: "docs",
        marks: [{ type: "link", attrs: { href: "https://example.com/x" } }],
      },
    ]);
  });

  it("nested emphasis inside a link label", () => {
    const nodes = parseInline("[**bold link**](https://e.com)");
    expect(nodes).toEqual([
      {
        type: "text",
        text: "bold link",
        marks: [
          { type: "link", attrs: { href: "https://e.com" } },
          { type: "strong" },
        ],
      },
    ]);
  });

  it("combines code marks with a link", () => {
    const nodes = parseInline("[`code`](https://e.com)");
    expect(nodes[0].marks).toEqual([
      { type: "link", attrs: { href: "https://e.com" } },
      { type: "code" },
    ]);
  });

  it("leaves an unclosed delimiter as literal text", () => {
    expect(parseInline("a * b")).toEqual([{ type: "text", text: "a * b" }]);
  });

  it("honours backslash escapes", () => {
    expect(parseInline("\\*not italic\\*")).toEqual([
      { type: "text", text: "*not italic*" },
    ]);
  });
});

describe("bodyToAdf - passthrough and plain text", () => {
  it("passes an existing ADF doc through unchanged (no double-encoding)", () => {
    const existing = {
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hi" }] },
      ],
    };
    const out = bodyToAdf(JSON.stringify(existing));
    expect(out).toEqual(existing);
  });

  it("treats non-ADF JSON-looking text as markdown", () => {
    const out = bodyToAdf('{ not really json');
    expect(out.type).toBe("doc");
    expect(out.content[0].type).toBe("paragraph");
  });

  it("produces a plain paragraph for plain text", () => {
    const out = bodyToAdf("hello world");
    expect(out.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "hello world" }] },
    ]);
  });

  it("isAdfDoc recognises only real docs", () => {
    expect(isAdfDoc({ type: "doc", version: 1, content: [] })).toBe(true);
    expect(isAdfDoc({ type: "paragraph" })).toBe(false);
    expect(isAdfDoc("nope")).toBe(false);
    expect(isAdfDoc(null)).toBe(false);
  });
});

describe("markdownToAdf - structural integrity", () => {
  it("never emits a text node containing a literal markdown heading marker", () => {
    const doc = markdownToAdf("## Heading\n\n- item");
    const flat = doc.content.flatMap(allTypes);
    expect(flat).toContain("heading");
    expect(flat).toContain("bulletList");
    // No text node should carry the raw "## Heading" string.
    const texts: string[] = [];
    const walk = (n: AdfNode) => {
      if (n.text) texts.push(n.text);
      (n.content ?? []).forEach(walk);
    };
    doc.content.forEach(walk);
    expect(texts.some((t) => t.includes("## Heading"))).toBe(false);
  });
});
