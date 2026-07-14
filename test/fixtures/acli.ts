/**
 * Recorded-contract fixtures for acli `--json` payloads (scout report risk R3).
 *
 * PROVENANCE: captured LIVE from acli v1.3.22-stable on 2026-07-14 against a
 * real authenticated Jira Cloud site, then anonymized (keys, names, summaries
 * and hosts replaced; structure, field sets, and value formats preserved
 * verbatim). Verified facts baked into these shapes:
 *  - `workitem search --json` returns a bare ARRAY of REST-shaped issues with
 *    `key` top-level and the rest under `fields`; the default field set is
 *    issuetype/key/assignee/priority/status/summary, and the --fields
 *    whitelist REJECTS `updated` ("field 'updated' is not allowed").
 *  - `workitem view --json` returns ONE object; created/updated/priority are
 *    only present when requested via --fields; timestamps use a numeric
 *    offset like "+0200"; description is an ADF document.
 *  - `workitem comment list --json` returns {comments, isLast, maxResults,
 *    startAt, total}; each comment is {id, author, body, visibility} with
 *    author and body as PLAIN STRINGS (no created timestamp, no ADF).
 *  - `project list --json` returns a bare ARRAY; `project view --json` one
 *    flat object; both carry projectTypeKey/style and lead.displayName.
 *
 * If a future acli version disagrees, re-capture and update these together
 * with the tolerant accessors in src/commands/jira/shared.ts.
 *
 * Timestamps are fixed; tests freeze the clock at FROZEN_NOW so relative-time
 * output stays deterministic.
 */

export const FROZEN_NOW = "2026-07-14T12:00:00.000Z";

/** `acli jira workitem search --jql ... --json` — bare array, default fields. */
export const searchPayload = [
  {
    changelog: null,
    editmeta: null,
    expand:
      "renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations",
    fields: {
      assignee: {
        accountId: "5b10a2844c20165700ede21g",
        accountType: "atlassian",
        active: true,
        displayName: "Jane Doe",
        emailAddress: "jane@acme.com",
        self: "https://example.atlassian.net/rest/api/3/user?accountId=5b10a2844c20165700ede21g",
      },
      issuetype: {
        description: "A problem which impairs product functions.",
        hierarchyLevel: 0,
        id: "10607",
        name: "Bug",
        self: "https://example.atlassian.net/rest/api/3/issuetype/10607",
        subtask: false,
      },
      priority: {
        id: "10000",
        name: "High",
        self: "https://example.atlassian.net/rest/api/3/priority/10000",
      },
      status: {
        description: "Work is actively underway.",
        id: "3",
        name: "In Progress",
        self: "https://example.atlassian.net/rest/api/3/status/3",
        statusCategory: {
          colorName: "yellow",
          id: 4,
          key: "indeterminate",
          name: "In Progress",
          self: "https://example.atlassian.net/rest/api/3/statuscategory/4",
        },
      },
      summary: "Fix login redirect loop",
    },
    fieldsToInclude: null,
    id: "10001",
    key: "TEAM-1",
    names: null,
    operations: null,
    properties: null,
    renderedFields: null,
    schema: null,
    self: "https://example.atlassian.net/rest/api/3/issue/10001",
    transitions: null,
    versionedRepresentations: null,
  },
  {
    expand:
      "renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations",
    fields: {
      assignee: null,
      issuetype: {
        id: "10002",
        name: "Task",
        self: "https://example.atlassian.net/rest/api/3/issuetype/10002",
        subtask: false,
      },
      priority: {
        id: "10001",
        name: "Medium",
        self: "https://example.atlassian.net/rest/api/3/priority/10001",
      },
      status: {
        id: "1",
        name: "To Do",
        self: "https://example.atlassian.net/rest/api/3/status/1",
        statusCategory: {
          colorName: "blue-gray",
          id: 2,
          key: "new",
          name: "To Do",
          self: "https://example.atlassian.net/rest/api/3/statuscategory/2",
        },
      },
      summary: "Add audit log export",
    },
    id: "10002",
    key: "TEAM-2",
    self: "https://example.atlassian.net/rest/api/3/issue/10002",
  },
];

/** `acli jira workitem view KEY --fields ... --json` — one object, full fields. */
export const viewPayload = {
  expand:
    "renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations",
  fields: {
    assignee: {
      accountId: "5b10a2844c20165700ede21g",
      accountType: "atlassian",
      active: true,
      displayName: "Jane Doe",
      emailAddress: "jane@acme.com",
    },
    created: "2026-07-01T09:00:00.000+0200",
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
    issuetype: { id: "10607", name: "Bug", subtask: false },
    priority: { id: "10000", name: "High" },
    status: {
      id: "3",
      name: "In Progress",
      statusCategory: { id: 4, key: "indeterminate", name: "In Progress" },
    },
    summary: "Fix login redirect loop",
    updated: "2026-07-13T12:00:00.000+0200",
  },
  id: "10001",
  key: "TEAM-1",
  self: "https://example.atlassian.net/rest/api/3/issue/10001",
};

/** Same work item after `transition --status Done`, for post-mutation re-fetch. */
export const viewPayloadDone = {
  ...viewPayload,
  fields: {
    ...viewPayload.fields,
    status: {
      id: "6",
      name: "Done",
      statusCategory: { id: 3, key: "done", name: "Done" },
    },
    updated: "2026-07-14T13:59:00.000+0200",
  },
};

/** `acli jira workitem comment list --key KEY --json` — flat string comments. */
export const commentListPayload = {
  comments: [
    {
      author: "Jane Doe",
      body: "Reproduced on staging.",
      id: "20001",
      visibility: "public",
    },
    {
      author: "John Smith",
      body: "Plain-text comments also occur.",
      id: "20002",
      visibility: "public",
    },
  ],
  isLast: true,
  maxResults: 50,
  startAt: 0,
  total: 2,
};

/** `acli jira workitem create ... --json` — REST create response (id/key/self). */
export const createPayload = {
  id: "10003",
  key: "TEAM-3",
  self: "https://example.atlassian.net/rest/api/3/issue/10003",
};

/** The created item as `view TEAM-3 --fields ... --json` returns it. */
export const viewCreatedPayload = {
  fields: {
    assignee: null,
    created: "2026-07-14T13:58:00.000+0200",
    description: "Created from atlassian-axi",
    issuetype: { id: "10002", name: "Task", subtask: false },
    priority: { id: "10001", name: "Medium" },
    status: {
      id: "1",
      name: "To Do",
      statusCategory: { id: 2, key: "new", name: "To Do" },
    },
    summary: "New task from CLI",
    updated: "2026-07-14T13:58:00.000+0200",
  },
  id: "10003",
  key: "TEAM-3",
  self: "https://example.atlassian.net/rest/api/3/issue/10003",
};

/** `acli jira project list --json` — bare array of flat REST projects. */
export const projectListPayload = [
  {
    archived: null,
    avatarUrls: {},
    description: "Main delivery project",
    id: "10000",
    isPrivate: false,
    key: "TEAM",
    lead: {
      accountId: "62beca8b174792b4ae0aa763",
      active: true,
      displayName: "Jane Doe",
      self: "https://example.atlassian.net/rest/api/3/user?accountId=62beca8b174792b4ae0aa763",
    },
    name: "Team Project",
    projectTypeKey: "software",
    self: "https://example.atlassian.net/rest/api/3/project/10000",
    simplified: false,
    style: "classic",
  },
  {
    id: "10100",
    key: "OPS",
    lead: { accountId: "5c00aa11bb22cc33dd44ee55", displayName: "John Smith" },
    name: "Operations",
    projectTypeKey: "service_desk",
    self: "https://example.atlassian.net/rest/api/3/project/10100",
    style: "classic",
  },
];

/** `acli jira project view --key TEAM --json` — one flat REST project. */
export const projectViewPayload = {
  archived: null,
  assigneeType: "UNASSIGNED",
  avatarUrls: {},
  description: "Main delivery project",
  id: "10000",
  isPrivate: false,
  key: "TEAM",
  lead: {
    accountId: "62beca8b174792b4ae0aa763",
    active: true,
    displayName: "Jane Doe",
  },
  name: "Team Project",
  projectTypeKey: "software",
  self: "https://example.atlassian.net/rest/api/3/project/10000",
  simplified: false,
  style: "classic",
};
