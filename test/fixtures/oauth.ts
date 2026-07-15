/**
 * Hand-authored fixtures for Atlassian OAuth 2.0 (3LO) payloads.
 *
 * PROVENANCE: hand-authored on 2026-07-15 from the published docs at
 * https://developer.atlassian.com/cloud/oauth/ (3LO guide: authorization-code
 * exchange, rotating refresh tokens, accessible-resources) — no live OAuth
 * exchange was captured in this worktree, the same fallback the Confluence
 * fixtures use. Shape facts baked in:
 *  - the token endpoint (`POST https://auth.atlassian.com/oauth/token`)
 *    returns `{access_token, expires_in (seconds), token_type: "Bearer",
 *    refresh_token, scope}`; with rotating refresh tokens EVERY refresh
 *    response carries a NEW refresh_token and invalidates the old one.
 *  - token endpoint errors are `{error, error_description}` with a 4xx status
 *    (`invalid_grant` for dead codes/refresh tokens).
 *  - accessible-resources (`GET
 *    https://api.atlassian.com/oauth/token/accessible-resources`) returns a
 *    BARE ARRAY of `{id, url, name, scopes, avatarUrl}` — id is the cloudId.
 * Update these together with the tolerant parsing in src/oauth.ts if a live
 * capture disagrees.
 */

export const tokenExchangePayload = {
  access_token: "access-token-initial",
  expires_in: 3600,
  token_type: "Bearer",
  refresh_token: "refresh-token-initial",
  scope:
    "read:confluence-content.all write:confluence-content read:confluence-space.summary search:confluence offline_access",
};

/** Refresh response — note the ROTATED refresh_token. */
export const tokenRefreshPayload = {
  access_token: "access-token-refreshed",
  expires_in: 3600,
  token_type: "Bearer",
  refresh_token: "refresh-token-rotated",
  scope:
    "read:confluence-content.all write:confluence-content read:confluence-space.summary search:confluence offline_access",
};

export const tokenErrorPayload = {
  error: "invalid_grant",
  error_description: "Unknown or invalid refresh token.",
};

export const accessibleResourcesSingle = [
  {
    id: "11111111-2222-3333-4444-555555555555",
    url: "https://acme.atlassian.net",
    name: "acme",
    scopes: ["read:jira-work", "read:confluence-content.all"],
    avatarUrl: "https://site-admin-avatar-cdn.example/avatars/240/site.png",
  },
];

export const accessibleResourcesMulti = [
  ...accessibleResourcesSingle,
  {
    id: "66666666-7777-8888-9999-000000000000",
    url: "https://other.atlassian.net",
    name: "other",
    scopes: ["read:jira-work"],
    avatarUrl: "https://site-admin-avatar-cdn.example/avatars/240/site2.png",
  },
];
