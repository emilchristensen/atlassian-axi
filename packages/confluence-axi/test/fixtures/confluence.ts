/**
 * Recorded-contract fixtures for Confluence Cloud REST payloads.
 *
 * PROVENANCE: hand-authored on 2026-07-15 against the published Confluence
 * Cloud REST contracts (v2 pages/spaces reference, v1 search reference) — no
 * authenticated site was available in this worktree for a live capture, the
 * same fallback PR #3 used for acli. Shape facts baked in:
 *  - v2 collections (`GET /wiki/api/v2/spaces`, `/pages`) return
 *    `{results: [...], _links}`; cursor pagination signals more data via
 *    `_links.next` (no total count anywhere in v2).
 *  - v2 page GET returns one object: id/status/title/spaceId/parentId are
 *    top-level STRINGS (ids are numeric strings), `version.number` is a
 *    number, and the body nests as `body.<representation>.value`.
 *  - v1 search (`GET /wiki/rest/api/search?cql=...`) returns
 *    `{results, start, limit, size, totalSize, _links}`; each hit nests the
 *    entity under `content` and decorates top-level title/excerpt with
 *    `@@@hl@@@...@@@endhl@@@` highlight markers.
 *  - Phase 4b additions (hand-authored 2026-07-15 from the same published
 *    contracts): v2 `GET /pages/{id}/attachments` returns AttachmentBulk
 *    results (id/status/title/mediaType/fileSize are top-level, ids are
 *    strings, fileSize is a number, version nests like pages); v2
 *    `GET /pages/{id}/labels` returns Label results ({id, name, prefix});
 *    v2 `GET /pages/{id}/children` returns ChildPage results
 *    ({id, status, title, spaceId, childPosition}). Label MUTATIONS are v1
 *    only (v2 has none): `POST /wiki/rest/api/content/{id}/label` takes a
 *    bare LabelCreate array (`[{prefix, name}]`) and returns a LabelArray;
 *    `DELETE .../label?name=<name>` returns 204.
 *
 * If a live capture ever disagrees, re-capture and update these together with
 * the tolerant accessors in src/commands/confluence/shared.ts.
 *
 * Timestamps are fixed; tests freeze the clock at FROZEN_NOW so relative-time
 * output stays deterministic.
 */

/** Frozen clock the tests pin so relative-time output stays deterministic. */
export const FROZEN_NOW = "2026-07-14T12:00:00.000Z";

/** `GET /wiki/api/v2/spaces?limit=N` — results envelope, no next page. */
export const spacesPayload = {
  results: [
    {
      authorId: "5b10a2844c20165700ede21g",
      createdAt: "2025-01-10T08:00:00.000Z",
      currentActiveAlias: "ENG",
      description: null,
      homepageId: "10001",
      icon: null,
      id: "111",
      key: "ENG",
      name: "Engineering",
      spaceOwnerId: null,
      status: "current",
      type: "global",
      _links: { webui: "/spaces/ENG" },
    },
    {
      authorId: "62beca8b174792b4ae0aa763",
      createdAt: "2025-03-02T09:30:00.000Z",
      currentActiveAlias: "DOCS",
      description: null,
      homepageId: "10002",
      icon: null,
      id: "222",
      key: "DOCS",
      name: "Documentation",
      spaceOwnerId: null,
      status: "current",
      type: "global",
      _links: { webui: "/spaces/DOCS" },
    },
  ],
  _links: { base: "https://example.atlassian.net/wiki" },
};

/** Same envelope with a cursor `next` link — more spaces exist. */
export const spacesPayloadWithNext = {
  ...spacesPayload,
  _links: {
    base: "https://example.atlassian.net/wiki",
    next: "/wiki/api/v2/spaces?cursor=eyJpZCI6MjIyfQ==&limit=2",
  },
};

/** `GET /wiki/api/v2/pages/12345?body-format=storage` — one page, v4. */
export const pagePayload = {
  authorId: "5b10a2844c20165700ede21g",
  body: {
    storage: {
      representation: "storage",
      value: "<p>Release notes for the July drop.</p>",
    },
  },
  createdAt: "2026-07-01T09:00:00.000Z",
  id: "12345",
  lastOwnerId: null,
  ownerId: "5b10a2844c20165700ede21g",
  parentId: "10001",
  parentType: "page",
  position: 100,
  spaceId: "111",
  status: "current",
  title: "Release notes",
  version: {
    authorId: "5b10a2844c20165700ede21g",
    createdAt: "2026-07-13T12:00:00.000Z",
    message: "",
    minorEdit: false,
    number: 4,
  },
  _links: {
    base: "https://example.atlassian.net/wiki",
    editui: "/pages/resumedraft.action?draftId=12345",
    webui: "/spaces/ENG/pages/12345/Release+notes",
  },
};

/** The same page after `page update` bumped it to v5 with a new body. */
export const pagePayloadUpdated = {
  ...pagePayload,
  body: {
    storage: {
      representation: "storage",
      value: "<p>Release notes for the July drop, amended.</p>",
    },
  },
  version: {
    ...pagePayload.version,
    createdAt: "2026-07-14T11:00:00.000Z",
    number: 5,
  },
};

/** `POST /wiki/api/v2/pages` response — the created page, version 1. */
export const pageCreatedPayload = {
  authorId: "5b10a2844c20165700ede21g",
  body: {
    storage: {
      representation: "storage",
      value: "<p>Fresh page from the CLI.</p>",
    },
  },
  createdAt: "2026-07-14T10:00:00.000Z",
  id: "67890",
  parentId: null,
  parentType: null,
  position: null,
  spaceId: "111",
  status: "current",
  title: "New page",
  version: {
    authorId: "5b10a2844c20165700ede21g",
    createdAt: "2026-07-14T10:00:00.000Z",
    message: "",
    minorEdit: false,
    number: 1,
  },
  _links: {
    base: "https://example.atlassian.net/wiki",
    webui: "/spaces/ENG/pages/67890/New+page",
  },
};

/** `GET /wiki/api/v2/pages?space-id=111&title=...` — empty (no duplicate). */
export const pagesLookupEmptyPayload = {
  results: [],
  _links: { base: "https://example.atlassian.net/wiki" },
};

/** Same lookup when a page with that title already exists in the space. */
export const pagesLookupHitPayload = {
  results: [pagePayload],
  _links: { base: "https://example.atlassian.net/wiki" },
};

/** `GET /wiki/rest/api/search?cql=...` — v1 CQL search results. */
export const searchPayload = {
  results: [
    {
      content: {
        id: "12345",
        status: "current",
        title: "Release notes",
        type: "page",
        _links: { webui: "/spaces/ENG/pages/12345/Release+notes" },
      },
      entityType: "content",
      excerpt:
        "@@@hl@@@Release@@@endhl@@@ notes for the July drop with the pagination fix.",
      friendlyLastModified: "Jul 13, 2026",
      lastModified: "2026-07-13T12:00:00.000Z",
      resultGlobalContainer: {
        displayUrl: "/spaces/ENG",
        title: "Engineering",
      },
      score: 1.2,
      title: "@@@hl@@@Release@@@endhl@@@ notes",
      url: "/spaces/ENG/pages/12345/Release+notes",
    },
    {
      content: {
        id: "67890",
        status: "current",
        title: "New page",
        type: "page",
        _links: { webui: "/spaces/ENG/pages/67890/New+page" },
      },
      entityType: "content",
      excerpt: "Fresh page from the CLI.",
      friendlyLastModified: "yesterday",
      lastModified: "2026-07-14T10:00:00.000Z",
      resultGlobalContainer: {
        displayUrl: "/spaces/ENG",
        title: "Engineering",
      },
      score: 0.8,
      title: "New page",
      url: "/spaces/ENG/pages/67890/New+page",
    },
  ],
  start: 0,
  limit: 30,
  size: 2,
  totalSize: 2,
  cqlQuery: 'space = "ENG" AND type = page',
  searchDuration: 42,
  _links: {
    base: "https://example.atlassian.net/wiki",
    context: "/wiki",
    self: "https://example.atlassian.net/wiki/rest/api/search?cql=...",
  },
};

/** `GET /wiki/api/v2/pages/12345/attachments` — two attachments, no next. */
export const attachmentsPayload = {
  results: [
    {
      id: "att900001",
      status: "current",
      title: "architecture.png",
      createdAt: "2026-07-10T09:00:00.000Z",
      pageId: "12345",
      mediaType: "image/png",
      mediaTypeDescription: "PNG Image",
      comment: "",
      fileId: "f1a2b3c4-d5e6-7890-abcd-ef1234567890",
      fileSize: 482133,
      webuiLink: "/pages/viewpageattachments.action?pageId=12345",
      downloadLink: "/download/attachments/12345/architecture.png",
      version: {
        authorId: "5b10a2844c20165700ede21g",
        createdAt: "2026-07-12T12:00:00.000Z",
        message: "",
        minorEdit: false,
        number: 2,
      },
      _links: {
        webui: "/pages/viewpageattachments.action?pageId=12345",
        download: "/download/attachments/12345/architecture.png",
      },
    },
    {
      id: "att900002",
      status: "current",
      title: "meeting-notes.pdf",
      createdAt: "2026-07-13T15:30:00.000Z",
      pageId: "12345",
      mediaType: "application/pdf",
      mediaTypeDescription: "PDF Document",
      comment: "July sync",
      fileId: "a9b8c7d6-e5f4-3210-fedc-ba0987654321",
      fileSize: 812,
      webuiLink: "/pages/viewpageattachments.action?pageId=12345",
      downloadLink: "/download/attachments/12345/meeting-notes.pdf",
      version: {
        authorId: "62beca8b174792b4ae0aa763",
        createdAt: "2026-07-13T15:30:00.000Z",
        message: "",
        minorEdit: false,
        number: 1,
      },
      _links: {
        webui: "/pages/viewpageattachments.action?pageId=12345",
        download: "/download/attachments/12345/meeting-notes.pdf",
      },
    },
  ],
  _links: { base: "https://example.atlassian.net/wiki" },
};

/** Same envelope with a cursor `next` link — more attachments exist. */
export const attachmentsPayloadWithNext = {
  ...attachmentsPayload,
  _links: {
    base: "https://example.atlassian.net/wiki",
    next: "/wiki/api/v2/pages/12345/attachments?cursor=eyJpZCI6OTAwMDAyfQ==&limit=2",
  },
};

/** `GET /wiki/api/v2/pages/12345/labels` — two global labels. */
export const labelsPayload = {
  results: [
    { id: "50001", name: "release", prefix: "global" },
    { id: "50002", name: "engineering", prefix: "global" },
  ],
  _links: { base: "https://example.atlassian.net/wiki" },
};

/** Same label set with a cursor `next` link — the page has MORE labels. */
export const labelsPayloadTruncated = {
  ...labelsPayload,
  _links: {
    base: "https://example.atlassian.net/wiki",
    next: "/wiki/api/v2/pages/12345/labels?cursor=eyJpZCI6NTAwMDJ9&limit=250",
  },
};

/** A page whose only label is TEAM-prefixed (no global labels at all). */
export const labelsTeamOnlyPayload = {
  results: [{ id: "50009", name: "release", prefix: "team" }],
  _links: { base: "https://example.atlassian.net/wiki" },
};

/** The label set after `labels --add july` (v2 re-fetch post-mutation). */
export const labelsAfterAddPayload = {
  results: [
    { id: "50001", name: "release", prefix: "global" },
    { id: "50002", name: "engineering", prefix: "global" },
    { id: "50003", name: "july", prefix: "global" },
  ],
  _links: { base: "https://example.atlassian.net/wiki" },
};

/** The label set after `labels --remove engineering` (v2 re-fetch). */
export const labelsAfterRemovePayload = {
  results: [{ id: "50001", name: "release", prefix: "global" }],
  _links: { base: "https://example.atlassian.net/wiki" },
};

/**
 * `POST /wiki/rest/api/content/12345/label` — v1 LabelArray response. The
 * CLI never parses it (the v2 re-fetch is authoritative), but the fake
 * returns the realistic shape anyway.
 */
export const labelAddedV1Payload = {
  results: [{ prefix: "global", name: "july", id: "50003", label: "july" }],
  start: 0,
  limit: 200,
  size: 1,
  _links: {
    base: "https://example.atlassian.net/wiki",
    context: "/wiki",
    self: "https://example.atlassian.net/wiki/rest/api/content/12345/label",
  },
};

/** `GET /wiki/api/v2/pages/12345/children` — two child pages, no next. */
export const childrenPayload = {
  results: [
    {
      id: "20001",
      status: "current",
      title: "Release notes / July details",
      spaceId: "111",
      childPosition: 1,
    },
    {
      id: "20002",
      status: "current",
      title: "Release notes / rollout checklist",
      spaceId: "111",
      childPosition: 2,
    },
  ],
  _links: { base: "https://example.atlassian.net/wiki" },
};

/** Same envelope with a cursor `next` link — more children exist. */
export const childrenPayloadWithNext = {
  ...childrenPayload,
  _links: {
    base: "https://example.atlassian.net/wiki",
    next: "/wiki/api/v2/pages/12345/children?cursor=eyJpZCI6MjAwMDJ9&limit=2",
  },
};

/** Confluence v2 error body (shape used by 4xx responses). */
export const errorBodyV2 = {
  errors: [
    {
      status: 404,
      code: "NOT_FOUND",
      title: "Page not found or viewer does not have permission",
      detail: null,
    },
  ],
};

/** Confluence v1 error body (search endpoint). */
export const errorBodyV1 = {
  statusCode: 400,
  message: "Could not parse cql: bogus ~~~",
  data: { authorized: true, valid: false },
};

/**
 * Confluence v2 anonymous/rejected-credential body — LIVE CAPTURE (the first
 * in this file), 2026-07-15, `GET /wiki/api/v2/spaces?limit=1` against a real
 * site with a rejected Basic credential. v2 answers bad credentials with 404
 * (anti-enumeration), byte-identical to an unauthenticated request; v1 says
 * 403 and Jira says 401 for the same failure.
 */
export const errorBodyV2Anonymous404 = {
  errors: [{ status: 404, code: "NOT_FOUND", title: "Not Found", detail: null }],
};
