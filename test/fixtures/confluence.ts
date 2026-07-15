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
 *
 * If a live capture ever disagrees, re-capture and update these together with
 * the tolerant accessors in src/commands/confluence/shared.ts.
 *
 * Timestamps are fixed; tests freeze the clock at FROZEN_NOW (shared with the
 * acli fixtures) so relative-time output stays deterministic.
 */

export { FROZEN_NOW } from "./acli.js";

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
