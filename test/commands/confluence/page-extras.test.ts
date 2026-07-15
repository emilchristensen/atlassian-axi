import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setConfluenceFetch } from "../../../src/confluence.js";
import {
  pageCommand,
  PAGE_HELP,
} from "../../../src/commands/confluence/page.js";
import {
  makeConfluenceFake,
  onPath,
  type FetchCall,
} from "../../helpers/confluenceFake.js";
import {
  FROZEN_NOW,
  attachmentsPayload,
  attachmentsPayloadWithNext,
  childrenPayload,
  childrenPayloadWithNext,
  labelAddedV1Payload,
  labelsAfterAddPayload,
  labelsAfterRemovePayload,
  labelsPayload,
} from "../../fixtures/confluence.js";

const ENV_KEYS = [
  "ATLASSIAN_SITE",
  "ATLASSIAN_EMAIL",
  "ATLASSIAN_API_TOKEN",
  "ATLASSIAN_AXI_NO_KEYCHAIN",
] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FROZEN_NOW));
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env["ATLASSIAN_SITE"] = "example.atlassian.net";
  process.env["ATLASSIAN_EMAIL"] = "me@acme.com";
  process.env["ATLASSIAN_API_TOKEN"] = "test-token";
  process.env["ATLASSIAN_AXI_NO_KEYCHAIN"] = "1";
});

afterEach(() => {
  setConfluenceFetch(null);
  vi.useRealTimers();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const getAttachments = onPath("GET", "/wiki/api/v2/pages/12345/attachments");
const getLabels = onPath("GET", "/wiki/api/v2/pages/12345/labels");
const getChildren = onPath("GET", "/wiki/api/v2/pages/12345/children");
const v1Label = (method: string) => (call: FetchCall) =>
  call.method === method &&
  call.url.pathname === "/wiki/rest/api/content/12345/label";

// ---------------------------------------------------------------------------
// attachments
// ---------------------------------------------------------------------------

describe("page attachments", () => {
  it("renders the TOON list from the recorded fixture (contract snapshot)", async () => {
    const { fetchImpl } = makeConfluenceFake([
      { match: getAttachments, result: attachmentsPayload },
    ]);
    setConfluenceFetch(fetchImpl);

    const out = await pageCommand(["attachments", "12345"]);
    expect(out).toMatchInlineSnapshot(`
      "count: 2
      attachments[2]{id,title,mediaType,size,version,updated}:
        att900001,architecture.png,image/png,471 KB,2,2d ago
        att900002,meeting-notes.pdf,application/pdf,812 B,1,20h ago
      help[2]:
        Narrow with \`atlassian-axi confluence page attachments 12345 --filename <name>\` or \`--media-type <type>\`
        Run \`atlassian-axi confluence page get 12345\` to read the page itself"
    `);
  });

  it("passes --limit/--media-type/--filename through as query params", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: getAttachments, result: attachmentsPayload },
    ]);
    setConfluenceFetch(fetchImpl);
    await pageCommand([
      "attachments",
      "12345",
      "--limit",
      "5",
      "--media-type",
      "image/png",
      "--filename",
      "architecture.png",
    ]);
    const params = calls[0].url.searchParams;
    expect(params.get("limit")).toBe("5");
    expect(params.get("mediaType")).toBe("image/png");
    expect(params.get("filename")).toBe("architecture.png");
  });

  it("marks a cursor next link as truncated in the count line", async () => {
    const { fetchImpl } = makeConfluenceFake([
      { match: getAttachments, result: attachmentsPayloadWithNext },
    ]);
    setConfluenceFetch(fetchImpl);
    const out = await pageCommand(["attachments", "12345"]);
    expect(out).toContain("count: 2 (showing first 2)");
  });

  it("renders an empty result with a count of 0 and a suggestion", async () => {
    const { fetchImpl } = makeConfluenceFake([
      { match: getAttachments, result: { results: [] } },
    ]);
    setConfluenceFetch(fetchImpl);
    const out = await pageCommand(["attachments", "12345"]);
    expect(out).toContain("count: 0");
    expect(out).toContain("attachments are added in the Confluence UI");
  });

  it("requires the page id and rejects a second positional", async () => {
    setConfluenceFetch(makeConfluenceFake([]).fetchImpl);
    await expect(pageCommand(["attachments"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(
      pageCommand(["attachments", "12345", "678"]),
    ).rejects.toThrow(/Unexpected extra argument: 678/);
  });

  it("rejects an unknown flag and returns help without hitting the API", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([]);
    setConfluenceFetch(fetchImpl);
    await expect(
      pageCommand(["attachments", "12345", "--media", "png"]),
    ).rejects.toThrow(/Unknown flag: --media/);
    expect(await pageCommand(["attachments", "--help"])).toBe(PAGE_HELP);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// labels — list
// ---------------------------------------------------------------------------

describe("page labels list", () => {
  it("renders the TOON list from the recorded fixture (contract snapshot)", async () => {
    const { fetchImpl } = makeConfluenceFake([
      { match: getLabels, result: labelsPayload },
    ]);
    setConfluenceFetch(fetchImpl);

    const out = await pageCommand(["labels", "12345"]);
    expect(out).toMatchInlineSnapshot(`
      "count: 2
      labels[2]{name,prefix,id}:
        release,global,"50001"
        engineering,global,"50002"
      help[2]:
        Run \`atlassian-axi confluence search "label = '<name>'"\` to find content sharing a label
        Run \`atlassian-axi confluence page labels 12345 --add <name>\` or \`--remove <name>\` to change them"
    `);
  });

  it("passes --prefix and --limit through and validates the prefix", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: getLabels, result: labelsPayload },
    ]);
    setConfluenceFetch(fetchImpl);
    await pageCommand(["labels", "12345", "--prefix", "global", "--limit", "7"]);
    expect(calls[0].url.searchParams.get("prefix")).toBe("global");
    expect(calls[0].url.searchParams.get("limit")).toBe("7");

    await expect(
      pageCommand(["labels", "12345", "--prefix", "bogus"]),
    ).rejects.toThrow(/Invalid --prefix: bogus/);
  });

  it("suggests --add when the page has no labels", async () => {
    const { fetchImpl } = makeConfluenceFake([
      { match: getLabels, result: { results: [] } },
    ]);
    setConfluenceFetch(fetchImpl);
    const out = await pageCommand(["labels", "12345"]);
    expect(out).toContain("count: 0");
    expect(out).toContain("--add <name,name,...>");
  });
});

// ---------------------------------------------------------------------------
// labels — add
// ---------------------------------------------------------------------------

describe("page labels add", () => {
  it("POSTs only the missing names (global prefix) and renders the re-fetched set", async () => {
    let mutated = false;
    const { fetchImpl, calls } = makeConfluenceFake([
      {
        match: getLabels,
        get result() {
          return mutated ? labelsAfterAddPayload : labelsPayload;
        },
      },
      { match: v1Label("POST"), result: labelAddedV1Payload },
    ]);
    setConfluenceFetch((url, init) => {
      const out = fetchImpl(url, init);
      if (init?.method === "POST") mutated = true;
      return out;
    });

    const out = await pageCommand([
      "labels",
      "12345",
      "--add",
      "july,release",
    ]);

    const post = calls.find((c: FetchCall) => c.method === "POST");
    expect(post?.url.pathname).toBe("/wiki/rest/api/content/12345/label");
    expect(post?.body).toEqual([{ prefix: "global", name: "july" }]);
    expect(out).toContain("message: Added: july; Already present: release");
    expect(out).toContain('july,global,"50003"');
  });

  it("is idempotent: adding only already-present names never POSTs", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: getLabels, result: labelsPayload },
    ]);
    setConfluenceFetch(fetchImpl);

    const out = await pageCommand(["labels", "12345", "--add", "release"]);
    expect(out).toContain("message: Already present: release");
    expect(calls.every((c: FetchCall) => c.method === "GET")).toBe(true);
  });

  it("rejects empty names, and --add combined with --remove or list-only flags", async () => {
    setConfluenceFetch(makeConfluenceFake([]).fetchImpl);
    await expect(
      pageCommand(["labels", "12345", "--add", "a,,b"]),
    ).rejects.toThrow(/Invalid --add value/);
    await expect(
      pageCommand(["labels", "12345", "--add", "a", "--remove", "b"]),
    ).rejects.toThrow(/--add and --remove cannot be combined/);
    await expect(
      pageCommand(["labels", "12345", "--add", "a", "--limit", "5"]),
    ).rejects.toThrow(/--limit only applies when listing/);
    await expect(
      pageCommand(["labels", "12345", "--add", "a", "--prefix", "global"]),
    ).rejects.toThrow(/--prefix only applies when listing/);
  });
});

// ---------------------------------------------------------------------------
// labels — remove
// ---------------------------------------------------------------------------

describe("page labels remove", () => {
  it("DELETEs present names via the v1 query-param variant and renders the re-fetched set", async () => {
    let mutated = false;
    const { fetchImpl, calls } = makeConfluenceFake([
      {
        match: getLabels,
        get result() {
          return mutated ? labelsAfterRemovePayload : labelsPayload;
        },
      },
      { match: v1Label("DELETE"), result: { status: 204 } },
    ]);
    setConfluenceFetch((url, init) => {
      const out = fetchImpl(url, init);
      if (init?.method === "DELETE") mutated = true;
      return out;
    });

    const out = await pageCommand([
      "labels",
      "12345",
      "--remove",
      "engineering,bogus",
    ]);

    const del = calls.find((c: FetchCall) => c.method === "DELETE");
    expect(del?.url.pathname).toBe("/wiki/rest/api/content/12345/label");
    expect(del?.url.searchParams.get("name")).toBe("engineering");
    expect(out).toContain(
      "message: Removed: engineering; Already absent: bogus",
    );
    expect(out).toContain('release,global,"50001"');
    expect(out).not.toContain("engineering,global");
  });

  it("is idempotent: removing an absent name never DELETEs", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: getLabels, result: labelsPayload },
    ]);
    setConfluenceFetch(fetchImpl);

    const out = await pageCommand(["labels", "12345", "--remove", "bogus"]);
    expect(out).toContain("message: Already absent: bogus");
    expect(calls.every((c: FetchCall) => c.method === "GET")).toBe(true);
  });

  it("treats a 404 on the DELETE itself (pre-read race) as already absent", async () => {
    const { fetchImpl } = makeConfluenceFake([
      { match: getLabels, result: labelsPayload },
      { match: v1Label("DELETE"), result: { status: 404, body: {} } },
    ]);
    setConfluenceFetch(fetchImpl);
    const out = await pageCommand([
      "labels",
      "12345",
      "--remove",
      "engineering",
    ]);
    expect(out).toContain("Already absent: engineering");
  });
});

// ---------------------------------------------------------------------------
// children
// ---------------------------------------------------------------------------

describe("page children", () => {
  it("renders the TOON list from the recorded fixture (contract snapshot)", async () => {
    const { fetchImpl } = makeConfluenceFake([
      { match: getChildren, result: childrenPayload },
    ]);
    setConfluenceFetch(fetchImpl);

    const out = await pageCommand(["children", "12345"]);
    expect(out).toMatchInlineSnapshot(`
      "count: 2
      children[2]{id,title,status,position}:
        "20001",Release notes / July details,current,1
        "20002",Release notes / rollout checklist,current,2
      help[2]:
        Run \`atlassian-axi confluence page get <id>\` to read a child page
        Run \`atlassian-axi confluence page children <id>\` to descend another level"
    `);
  });

  it("passes --limit through and marks a next link as truncated", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: getChildren, result: childrenPayloadWithNext },
    ]);
    setConfluenceFetch(fetchImpl);
    const out = await pageCommand(["children", "12345", "--limit", "2"]);
    expect(calls[0].url.searchParams.get("limit")).toBe("2");
    expect(out).toContain("count: 2 (showing first 2)");
  });

  it("suggests creating a child page when there are none", async () => {
    const { fetchImpl } = makeConfluenceFake([
      { match: getChildren, result: { results: [] } },
    ]);
    setConfluenceFetch(fetchImpl);
    const out = await pageCommand(["children", "12345"]);
    expect(out).toContain("count: 0");
    expect(out).toContain("--parent 12345");
  });

  it("requires the page id and accepts flags before the positional", async () => {
    const { fetchImpl, calls } = makeConfluenceFake([
      { match: getChildren, result: childrenPayload },
    ]);
    setConfluenceFetch(fetchImpl);
    await expect(pageCommand(["children"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await pageCommand(["children", "--limit", "5", "12345"]);
    expect(calls[0].url.pathname).toBe("/wiki/api/v2/pages/12345/children");
  });
});
