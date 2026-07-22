import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Markdown -> Atlassian Document Format (ADF) conversion.
 *
 * Jira's `description` and comment `body` are ADF, not text. acli accepts a
 * plain string and (per its --description/--body contract) wraps it in a single
 * flat text node, so markdown like `## Heading` renders as literal `##` in Jira.
 * We convert markdown to a structured ADF document ourselves and hand it to
 * acli's proven ADF ingestion (`--description-file` / `--body-file`, which
 * accept an ADF JSON file), so headings, lists, code, emphasis and links render
 * as real Jira nodes.
 *
 * The conversion is intentionally a focused subset (headings, ordered/unordered
 * lists incl. nesting, inline code, fenced code blocks, bold/italic, links)
 * rather than a full CommonMark implementation - that subset is what Jira
 * descriptions and comments actually use, and keeping it in-repo avoids adding a
 * markdown-parser runtime dependency to a deliberately tiny dependency tree.
 */

export interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  marks?: AdfMark[];
}

export interface AdfDoc {
  type: "doc";
  version: number;
  content: AdfNode[];
}

/** Whether a parsed value is already an ADF document (`{type:"doc",...}`). */
export function isAdfDoc(value: unknown): value is AdfDoc {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "doc" &&
    Array.isArray((value as { content?: unknown }).content)
  );
}

/**
 * Resolve a raw body string to an ADF document. A body that is already ADF JSON
 * is passed through unchanged (no double-encoding); anything else is treated as
 * markdown (plain text with no markup becomes a single paragraph).
 */
export function bodyToAdf(body: string): AdfDoc {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isAdfDoc(parsed)) return parsed;
    } catch {
      // Not JSON - fall through and treat as markdown.
    }
  }
  return markdownToAdf(body);
}

/**
 * Write the ADF form of `body` to a private temp file for acli to read via
 * `--description-file`/`--body-file`. Returns the path and a cleanup callback
 * the caller MUST invoke (in a finally) once acli has consumed the file.
 */
export function writeAdfTempFile(body: string): {
  path: string;
  cleanup: () => void;
} {
  const doc = bodyToAdf(body);
  const dir = mkdtempSync(join(tmpdir(), "jira-axi-adf-"));
  const path = join(dir, "body.json");
  writeFileSync(path, JSON.stringify(doc), "utf8");
  return {
    path,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup; a leftover temp file is harmless.
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Block-level parsing
// ---------------------------------------------------------------------------

/** Convert a markdown string to an ADF document. */
export function markdownToAdf(md: string): AdfDoc {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const content = parseBlocks(lines);
  // ADF requires at least one node; a blank body becomes an empty paragraph.
  if (content.length === 0) {
    content.push({ type: "paragraph", content: [] });
  }
  return { type: "doc", version: 1, content };
}

function parseBlocks(lines: string[]): AdfNode[] {
  const nodes: AdfNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }

    const fence = matchFence(line);
    if (fence) {
      const block = readFence(lines, i, fence);
      nodes.push(block.node);
      i = block.next;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      nodes.push({
        type: "heading",
        attrs: { level: heading[1].length },
        content: parseInline(heading[2]),
      });
      i++;
      continue;
    }

    if (parseListLine(line)) {
      const list = parseList(lines, i, indentWidth(line));
      nodes.push(list.node);
      i = list.next;
      continue;
    }

    // Paragraph: consecutive non-blank lines that start no other block.
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !matchFence(lines[i]) &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !parseListLine(lines[i])
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    nodes.push({ type: "paragraph", content: inlineWithHardBreaks(paraLines) });
  }
  return nodes;
}

interface FenceMatch {
  marker: string;
  lang: string;
}

/** Match an opening/closing code fence (``` or ~~~), capturing the language. */
function matchFence(line: string): FenceMatch | null {
  const m = /^\s*(```+|~~~+)\s*([\w+-]*)\s*$/.exec(line);
  if (!m) return null;
  return { marker: m[1][0].repeat(3), lang: m[2] };
}

function readFence(
  lines: string[],
  start: number,
  fence: FenceMatch,
): { node: AdfNode; next: number } {
  const body: string[] = [];
  let i = start + 1;
  for (; i < lines.length; i++) {
    const close = matchFence(lines[i]);
    if (close && close.marker === fence.marker) {
      i++;
      break;
    }
    body.push(lines[i]);
  }
  const text = body.join("\n");
  const node: AdfNode = {
    type: "codeBlock",
    content: text ? [{ type: "text", text }] : [],
  };
  if (fence.lang) node.attrs = { language: fence.lang };
  return { node, next: i };
}

interface ListLine {
  indent: number;
  ordered: boolean;
  order: number;
  text: string;
}

/** Parse a single list-item line; null when the line is not a list item. */
function parseListLine(line: string): ListLine | null {
  const m = /^(\s*)([-*+]|(\d+)[.)])\s+(.*)$/.exec(line);
  if (!m) return null;
  const ordered = m[3] !== undefined;
  return {
    indent: expandTabs(m[1]).length,
    ordered,
    order: ordered ? Number(m[3]) : 1,
    text: m[4],
  };
}

/** Deepest list nesting we recurse into before flattening (stack-overflow guard). */
const MAX_LIST_DEPTH = 20;

/**
 * Parse a (possibly nested) list starting at `start` whose items sit at
 * `baseIndent`. Deeper-indented items attach as nested lists to the item above
 * them. A blank line or a dedent below `baseIndent` ends the list.
 */
function parseList(
  lines: string[],
  start: number,
  baseIndent: number,
  depth = 0,
): { node: AdfNode; next: number } {
  const first = parseListLine(lines[start]) as ListLine;
  const ordered = first.ordered;
  const items: AdfNode[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") break;
    const item = parseListLine(line);
    if (!item) break;
    if (item.indent < baseIndent) break;

    // Beyond MAX_LIST_DEPTH, stop recursing on deeper indents and attach the
    // item at the current level instead. Jira renders nowhere near this depth;
    // the cap only stops a pathological indent ladder from overflowing the
    // stack (an uncaught RangeError -> raw crash).
    if (item.indent > baseIndent && depth < MAX_LIST_DEPTH) {
      const nested = parseList(lines, i, item.indent, depth + 1);
      if (items.length === 0) {
        items.push({ type: "listItem", content: [nested.node] });
      } else {
        (items[items.length - 1].content as AdfNode[]).push(nested.node);
      }
      i = nested.next;
      continue;
    }

    // A different marker family at the same level starts a separate list.
    if (item.ordered !== ordered) break;

    items.push({
      type: "listItem",
      content: [{ type: "paragraph", content: parseInline(item.text) }],
    });
    i++;
  }

  const node: AdfNode = ordered
    ? { type: "orderedList", attrs: { order: first.order }, content: items }
    : { type: "bulletList", content: items };
  return { node, next: i };
}

function inlineWithHardBreaks(paraLines: string[]): AdfNode[] {
  const out: AdfNode[] = [];
  paraLines.forEach((line, index) => {
    if (index > 0) out.push({ type: "hardBreak" });
    out.push(...parseInline(line));
  });
  return out;
}

function indentWidth(line: string): number {
  const m = /^(\s*)/.exec(line);
  return expandTabs(m ? m[1] : "").length;
}

function expandTabs(ws: string): string {
  return ws.replace(/\t/g, "    ");
}

// ---------------------------------------------------------------------------
// Inline parsing
// ---------------------------------------------------------------------------

const PUNCT = new Set("\\`*_{}[]()#+-.!>~".split(""));

/** Deepest inline mark/link nesting before the rest is kept as plain text. */
const MAX_INLINE_DEPTH = 50;

/** Parse inline markdown (marks, code, links) into ADF inline nodes. */
export function parseInline(text: string): AdfNode[] {
  return parseInlineWithMarks(text, [], 0);
}

function textNode(text: string, marks: AdfMark[]): AdfNode {
  const node: AdfNode = { type: "text", text };
  if (marks.length > 0) node.marks = marks.map((m) => ({ ...m }));
  return node;
}

function parseInlineWithMarks(
  text: string,
  marks: AdfMark[],
  depth = 0,
): AdfNode[] {
  // Nested marks/links (`[[[...`, `***...`) recurse per level; beyond the cap
  // keep the remaining slice as plain text so a pathological input degrades
  // instead of overflowing the stack.
  if (depth > MAX_INLINE_DEPTH) {
    return text ? [textNode(text, marks)] : [];
  }
  const nodes: AdfNode[] = [];
  let buf = "";
  let i = 0;
  const flush = () => {
    if (buf) {
      nodes.push(textNode(buf, marks));
      buf = "";
    }
  };

  while (i < text.length) {
    const c = text[i];

    // Backslash escape of an ASCII punctuation char.
    if (c === "\\" && i + 1 < text.length && PUNCT.has(text[i + 1])) {
      buf += text[i + 1];
      i += 2;
      continue;
    }

    // Inline code span: a run of backticks, closed by an equal-length run.
    if (c === "`") {
      const run = runLength(text, i, "`");
      const close = findCodeClose(text, i + run, run);
      if (close !== -1) {
        flush();
        nodes.push(
          textNode(trimCodeSpan(text.slice(i + run, close)), [
            ...marks,
            { type: "code" },
          ]),
        );
        i = close + run;
        continue;
      }
    }

    // Link: [label](href)
    if (c === "[") {
      const link = matchLink(text, i);
      if (link) {
        flush();
        nodes.push(
          ...parseInlineWithMarks(
            link.label,
            [...marks, { type: "link", attrs: { href: link.href } }],
            depth + 1,
          ),
        );
        i = link.end;
        continue;
      }
    }

    // Strong: ** ** or __ __
    if ((c === "*" || c === "_") && text[i + 1] === c) {
      if (c === "*" || wordBoundaryBefore(text, i)) {
        const close = findClose(text, i + 2, c + c, c);
        if (close > i + 2) {
          flush();
          nodes.push(
            ...parseInlineWithMarks(
              text.slice(i + 2, close),
              [...marks, { type: "strong" }],
              depth + 1,
            ),
          );
          i = close + 2;
          continue;
        }
      }
    }

    // Emphasis: * * or _ _
    if (c === "*" || c === "_") {
      if (c === "*" || wordBoundaryBefore(text, i)) {
        const close = findClose(text, i + 1, c, c);
        if (close > i + 1) {
          flush();
          nodes.push(
            ...parseInlineWithMarks(
              text.slice(i + 1, close),
              [...marks, { type: "em" }],
              depth + 1,
            ),
          );
          i = close + 1;
          continue;
        }
      }
    }

    buf += c;
    i++;
  }

  flush();
  return nodes;
}

function runLength(text: string, start: number, ch: string): number {
  let n = 0;
  while (text[start + n] === ch) n++;
  return n;
}

/**
 * Find a closing backtick run of exactly `run` length at or after `from`.
 * Returns the index of the first backtick of that run, or -1 if none.
 */
function findCodeClose(text: string, from: number, run: number): number {
  let i = from;
  while (i < text.length) {
    if (text[i] === "`") {
      const len = runLength(text, i, "`");
      if (len === run) return i;
      i += len;
    } else {
      i++;
    }
  }
  return -1;
}

/** Per CommonMark: strip one leading+trailing space from a code span if both. */
function trimCodeSpan(code: string): string {
  if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ")) {
    return code.slice(1, -1);
  }
  return code;
}

/**
 * Find the closing delimiter for emphasis/strong. For `_`/`__` the close must
 * sit at a word boundary so `snake_case` is never treated as emphasis. Returns
 * the index of the delimiter, or -1 when unclosed.
 */
function findClose(
  text: string,
  from: number,
  delim: string,
  ch: string,
): number {
  let i = from;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text.startsWith(delim, i)) {
      // A longer run of the same char is not our close (e.g. `*` vs `**`).
      const longer = text[i + delim.length] === ch;
      const boundaryOk = ch === "*" || wordBoundaryAfter(text, i + delim.length);
      const contentBefore = i > from;
      if (!longer && boundaryOk && contentBefore) return i;
    }
    i++;
  }
  return -1;
}

function wordBoundaryBefore(text: string, i: number): boolean {
  const prev = text[i - 1];
  return prev === undefined || !/\w/.test(prev);
}

function wordBoundaryAfter(text: string, i: number): boolean {
  const next = text[i];
  return next === undefined || !/\w/.test(next);
}

interface LinkMatch {
  label: string;
  href: string;
  end: number;
}

/** Match a `[label](href)` link starting at `[`; null when it is not one. */
function matchLink(text: string, start: number): LinkMatch | null {
  let i = start + 1;
  let depth = 1;
  while (i < text.length && depth > 0) {
    const c = text[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]") depth--;
    if (depth === 0) break;
    i++;
  }
  if (depth !== 0 || text[i] !== "]" || text[i + 1] !== "(") return null;
  const label = text.slice(start + 1, i);
  const hrefStart = i + 2;
  const hrefEnd = text.indexOf(")", hrefStart);
  if (hrefEnd === -1) return null;
  const href = text.slice(hrefStart, hrefEnd).trim();
  if (!href || !isSafeHref(href)) return null;
  return { label, href, end: hrefEnd + 1 };
}

/**
 * Whether a link href is safe to emit as an ADF link mark. A `javascript:`,
 * `data:`, `vbscript:` or `file:` href is a script/exfil vector if the ADF is
 * ever rendered somewhere that trusts it, so those links degrade to plain text
 * (the visible `[label](href)` is preserved, just not made clickable).
 *
 * Control chars and whitespace are stripped before the scheme is read because
 * browsers ignore them when resolving a scheme (`java\tscript:` is javascript:),
 * so a naive scheme check would be bypassable.
 */
function isSafeHref(href: string): boolean {
  // Stripping control chars + whitespace is the whole point (browsers do the
  // same before resolving a scheme), so the control-char class is deliberate.
  // eslint-disable-next-line no-control-regex
  const normalized = href.replace(/[\u0000-\u0020]/g, "").toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(normalized);
  if (!scheme) return true; // relative, anchor, or protocol-relative
  return ["http", "https", "mailto", "tel", "ftp"].includes(scheme[1]);
}
