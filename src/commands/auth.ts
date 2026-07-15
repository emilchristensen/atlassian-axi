import { acliRaw, acliExec, acliInstalled } from "../acli.js";
import { takeFlag } from "../args.js";
import {
  type AtlassianCredential,
  clearCredential,
  normalizeSite,
  readTokenFromStdin,
  resolveCredential,
  saveCredential,
} from "../config.js";
import { AxiError } from "../errors.js";
import { renderHelp, renderOutput } from "../toon.js";

export const AUTH_HELP = `usage: atlassian-axi auth <login|status|logout> [flags]
Manage the unified Atlassian credential (site + email + API token). The token
is read from stdin only, never as an argument.

login   Persist a credential and bootstrap acli from it.
        --site <site>   e.g. mysite.atlassian.net (falls back to ATLASSIAN_SITE / stored)
        --email <email> account email (falls back to ATLASSIAN_EMAIL / stored)
        token via stdin: echo -n "<token>" | atlassian-axi auth login --site s --email e
status  Verify both halves: credential present, acli logged in, Confluence REST 200.
logout  Clear our credential/keychain and log acli out.

examples:
  echo -n "$TOKEN" | atlassian-axi auth login --site acme.atlassian.net --email me@acme.com
  atlassian-axi auth status
  atlassian-axi auth logout
`;

const REST_SPACES_PATH = "/wiki/api/v2/spaces?limit=1";

export async function authCommand(args: string[]): Promise<string> {
  const action = args[0];
  const rest = args.slice(1);
  switch (action) {
    case "login":
      return authLogin(rest);
    case "status":
      return authStatus();
    case "logout":
      return authLogout();
    default:
      throw new AxiError(
        action ? `Unknown auth action: ${action}` : "Missing auth action",
        "VALIDATION_ERROR",
        ["Run `atlassian-axi auth <login|status|logout>`"],
      );
  }
}

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------

async function authLogin(args: string[]): Promise<string> {
  const siteFlag = takeFlag(args, "--site");
  const emailFlag = takeFlag(args, "--email");

  // Flags win, then fall back to any already-resolved (env/stored) values so a
  // re-login only needs to supply what changed.
  const resolved = await resolveCredential();
  const site = normalizeSite(siteFlag ?? resolved.site);
  const email = (emailFlag ?? resolved.email)?.trim();

  if (!site || !email) {
    const missing = [!site ? "--site" : null, !email ? "--email" : null].filter(
      Boolean,
    );
    throw new AxiError(
      `Missing required credential fields: ${missing.join(", ")}`,
      "VALIDATION_ERROR",
      [
        `echo -n "<token>" | atlassian-axi auth login --site <site> --email <email>`,
      ],
    );
  }

  // Token is stdin-only; TTY throws before we touch anything else.
  const apiToken = await readTokenFromStdin();
  const credential: AtlassianCredential = { site, email, apiToken };

  const { tokenStore } = await saveCredential(credential);
  const bootstrap = await bootstrapAcli(credential);

  return renderOutput([
    [
      "auth:",
      `  action: login`,
      `  site: ${site}`,
      `  email: ${email}`,
      `  token-store: ${tokenStore}`,
      `  acli: ${bootstrap}`,
    ].join("\n"),
    renderHelp(["Verify end-to-end with `atlassian-axi auth status`"]),
  ]);
}

/**
 * Bootstrap acli from our credential, status-gated so it is idempotent: only
 * log acli in when it is not already authenticated to the configured site.
 * acli's own store stays a derived cache of our source of truth.
 */
async function bootstrapAcli(credential: AtlassianCredential): Promise<string> {
  if (!(await acliInstalled())) {
    return "not installed (Jira half unavailable until acli is installed)";
  }
  if (await acliLoggedIntoSite(credential.site)) {
    return `already logged in to ${credential.site}`;
  }
  await acliExec(
    [
      "jira",
      "auth",
      "login",
      "--site",
      credential.site,
      "--email",
      credential.email,
      "--token",
    ],
    credential.apiToken,
  );
  return `logged in to ${credential.site}`;
}

/** True when acli reports an authenticated session for the given site. */
async function acliLoggedIntoSite(site: string): Promise<boolean> {
  const result = await acliRaw(["jira", "auth", "status"]);
  if (result.exitCode !== 0) {
    return false;
  }
  const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return output.includes(site.toLowerCase());
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

async function authStatus(): Promise<string> {
  const resolved = await resolveCredential();
  const missing: string[] = [];
  if (!resolved.site) missing.push("site");
  if (!resolved.email) missing.push("email");
  if (!resolved.apiToken) missing.push("apiToken");
  if (missing.length > 0) {
    throw new AxiError(
      `Not authenticated (missing: ${missing.join(", ")})`,
      "AUTH_REQUIRED",
      [
        "Run `atlassian-axi auth login --site <site> --email <email>` (token via stdin)",
      ],
    );
  }

  const credential: AtlassianCredential = {
    site: resolved.site as string,
    email: resolved.email as string,
    apiToken: resolved.apiToken as string,
  };

  // acli (Jira) half.
  let acliState: string;
  if (!(await acliInstalled())) {
    acliState = "not installed";
  } else if (await acliLoggedIntoSite(credential.site)) {
    acliState = "logged in";
  } else {
    acliState = "not logged in";
  }

  // Confluence REST half — a cheap authenticated call.
  const rest = await confluencePing(credential);

  const ok = acliState === "logged in" && rest.ok;
  const detail = [
    "auth:",
    `  status: ${ok ? "ok" : "degraded"}`,
    `  site: ${credential.site}`,
    `  email: ${credential.email}`,
    `  token: present (${resolved.sources.apiToken})`,
    `  acli: ${acliState}`,
    `  confluence: ${rest.ok ? "200 ok" : `${rest.status} ${rest.detail}`}`,
  ].join("\n");

  if (!ok) {
    if (acliState === "not installed") {
      throw new AxiError(
        `acli is not installed — see https://developer.atlassian.com/cloud/acli/\n${detail}`,
        "ACLI_NOT_INSTALLED",
        ["Install with `brew install acli`, then `acli --version` to verify"],
      );
    }
    throw new AxiError(`auth check failed\n${detail}`, "AUTH_REQUIRED", [
      acliState !== "logged in"
        ? "Re-run `atlassian-axi auth login` to bootstrap acli"
        : "Check the site/token — Confluence REST did not return 200",
    ]);
  }

  return renderOutput([detail]);
}

interface PingResult {
  ok: boolean;
  status: number;
  detail: string;
}

/** GET /wiki/api/v2/spaces?limit=1 with Basic auth; 200 means the token works. */
async function confluencePing(
  credential: AtlassianCredential,
): Promise<PingResult> {
  const url = `https://${credential.site}${REST_SPACES_PATH}`;
  const basic = Buffer.from(
    `${credential.email}:${credential.apiToken}`,
  ).toString("base64");
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: "application/json",
      },
    });
    return {
      ok: response.status === 200,
      status: response.status,
      detail: response.status === 200 ? "ok" : response.statusText,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      detail: error instanceof Error ? error.message : "request failed",
    };
  }
}

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------

async function authLogout(): Promise<string> {
  await clearCredential();

  let acliState = "skipped (not installed)";
  if (await acliInstalled()) {
    const result = await acliRaw(["jira", "auth", "logout"]);
    acliState =
      result.exitCode === 0
        ? "logged out"
        : `failed (exit ${result.exitCode}): ${result.stderr.trim() || result.stdout.trim() || "unknown error"}`;
  }

  return renderOutput([
    ["auth:", `  action: logout`, `  credential: cleared`, `  acli: ${acliState}`].join(
      "\n",
    ),
  ]);
}
