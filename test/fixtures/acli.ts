/**
 * Recorded-contract fixtures for acli `--json` payloads (scout report risk R3).
 *
 * PROVENANCE: hand-verified, NOT captured from a live acli run. acli v1.3.22
 * was installed locally at build time (2026-07-14) but unauthenticated, and no
 * Atlassian credential was available, so a real capture was impossible. The
 * flag surface was pinned from real `acli jira ... --help` output (v1.3.22);
 * the JSON shapes mirror the Jira Cloud REST v2/v3 issue/project payloads that
 * acli proxies (https://developer.atlassian.com/cloud/jira/platform/rest/v3/):
 * `key` at top level, everything else under `fields`, named objects with
 * `name`/`displayName`, Jira's `+0000` timestamp offset format.
 *
 * If a live capture ever disagrees with these shapes, update the fixtures and
 * the tolerant accessors in src/commands/jira/shared.ts together.
 *
 * Timestamps are fixed; tests freeze the clock at FROZEN_NOW so relative-time
 * output stays deterministic.
 */

export const FROZEN_NOW = "2026-07-14T12:00:00.000Z";

/** `acli jira workitem search --jql ... --json` — array of REST-shaped issues. */
export const searchPayload = [
  {
    id: "10001",
    key: "TEAM-1",
    fields: {
      summary: "Fix login redirect loop",
      issuetype: { name: "Bug" },
      priority: { name: "High" },
      status: { name: "In Progress" },
      assignee: {
        accountId: "5b10a2844c20165700ede21g",
        displayName: "Jane Doe",
        emailAddress: "jane@acme.com",
      },
      created: "2026-07-01T09:00:00.000+0000",
      updated: "2026-07-13T12:00:00.000+0000",
    },
  },
  {
    id: "10002",
    key: "TEAM-2",
    fields: {
      summary: "Add audit log export",
      issuetype: { name: "Task" },
      priority: { name: "Medium" },
      status: { name: "To Do" },
      assignee: null,
      created: "2026-06-14T12:00:00.000+0000",
      updated: "2026-07-11T12:00:00.000+0000",
    },
  },
];

/** `acli jira workitem view TEAM-1 --json` — one REST-shaped issue, ADF description. */
export const viewPayload = {
  id: "10001",
  key: "TEAM-1",
  fields: {
    summary: "Fix login redirect loop",
    issuetype: { name: "Bug" },
    priority: { name: "High" },
    status: { name: "In Progress" },
    assignee: {
      accountId: "5b10a2844c20165700ede21g",
      displayName: "Jane Doe",
      emailAddress: "jane@acme.com",
    },
    created: "2026-07-01T09:00:00.000+0000",
    updated: "2026-07-13T12:00:00.000+0000",
    description: {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Login loops back to the SSO page." },
          ],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Repro: log in with a fresh session." }],
        },
      ],
    },
  },
};

/** Same work item after `transition --status Done`, for post-mutation re-fetch. */
export const viewPayloadDone = {
  ...viewPayload,
  fields: {
    ...viewPayload.fields,
    status: { name: "Done" },
    updated: "2026-07-14T11:59:00.000+0000",
  },
};

/** `acli jira workitem comment list --key TEAM-1 --json` — REST comment envelope. */
export const commentListPayload = {
  startAt: 0,
  maxResults: 50,
  total: 2,
  comments: [
    {
      id: "20001",
      author: { displayName: "Jane Doe" },
      body: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Reproduced on staging." }],
          },
        ],
      },
      created: "2026-07-12T12:00:00.000+0000",
    },
    {
      id: "20002",
      author: { displayName: "John Smith" },
      body: "Plain-text comments also occur.",
      created: "2026-07-13T12:00:00.000+0000",
    },
  ],
};

/** `acli jira workitem create ... --json` — REST create response (id/key/self). */
export const createPayload = {
  id: "10003",
  key: "TEAM-3",
  self: "https://acme.atlassian.net/rest/api/3/issue/10003",
};

/** The created item as `view TEAM-3 --json` returns it. */
export const viewCreatedPayload = {
  id: "10003",
  key: "TEAM-3",
  fields: {
    summary: "New task from CLI",
    issuetype: { name: "Task" },
    priority: { name: "Medium" },
    status: { name: "To Do" },
    assignee: null,
    created: "2026-07-14T11:58:00.000+0000",
    updated: "2026-07-14T11:58:00.000+0000",
    description: "Created from atlassian-axi",
  },
};

/** `acli jira project list --json` — REST project-search envelope (`values`). */
export const projectListPayload = {
  self: "https://acme.atlassian.net/rest/api/3/project/search",
  maxResults: 30,
  startAt: 0,
  total: 2,
  isLast: true,
  values: [
    {
      id: "10000",
      key: "TEAM",
      name: "Team Project",
      projectTypeKey: "software",
      lead: { displayName: "Jane Doe" },
    },
    {
      id: "10100",
      key: "OPS",
      name: "Operations",
      projectTypeKey: "service_desk",
      lead: { displayName: "John Smith" },
    },
  ],
};

/** `acli jira project view --key TEAM --json` — one REST-shaped project. */
export const projectViewPayload = {
  id: "10000",
  key: "TEAM",
  name: "Team Project",
  projectTypeKey: "software",
  lead: { displayName: "Jane Doe" },
  description: "Main delivery project",
};
