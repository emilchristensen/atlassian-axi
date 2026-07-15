import { execFile } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { AxiError } from "./errors.js";

/**
 * Unified Atlassian credential — the single source of truth shared by the
 * acli-backed Jira half and the direct-REST Confluence half. Atlassian API
 * tokens are account-scoped, so one triple serves both.
 */
export interface AtlassianCredential {
  site: string;
  email: string;
  apiToken: string;
}

/** Where each resolved field came from, so callers can explain precedence. */
export type CredentialSource = "env" | "config" | "keychain";

/** Partial resolution — any field may be missing until fully configured. */
export interface ResolvedCredential {
  site?: string;
  email?: string;
  apiToken?: string;
  sources: {
    site?: CredentialSource;
    email?: CredentialSource;
    apiToken?: CredentialSource;
  };
}

/**
 * OAuth 2.0 (3LO) session for the Confluence REST half. Persisted in the 0600
 * config file (the "existing 0600 config store" by design — OAuth tokens are
 * short-lived and rotate, unlike the long-lived API token that prefers the
 * keychain). Atlassian rotates refresh tokens: always persist the newest.
 */
export interface OAuthSession {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
  /** Atlassian cloud id — addresses `https://api.atlassian.com/ex/confluence/{cloudId}`. */
  cloudId: string;
  /** Bare host of the chosen site, e.g. acme.atlassian.net. */
  site: string;
  /** Space-separated granted scopes, as returned by the token endpoint. */
  scopes: string;
  /** Stored on first login when not supplied via ATLASSIAN_AXI_OAUTH_CLIENT_SECRET. */
  clientSecret?: string;
}

interface StoredConfig {
  site?: string;
  email?: string;
  /** Present only in the file-fallback path (no OS keychain available). */
  token?: string;
  oauth?: OAuthSession;
}

const CONFIG_DIR_NAME = "atlassian-axi";
const CONFIG_FILE_NAME = "config.json";
const KEYCHAIN_SERVICE = "atlassian-axi";
const KEYCHAIN_ACCOUNT = "api-token";
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

/** Base config directory: `$XDG_CONFIG_HOME` or `~/.config`. */
function configBaseDir(): string {
  const xdg = process.env["XDG_CONFIG_HOME"];
  if (xdg && xdg.trim() !== "") {
    return xdg;
  }
  return join(homedir(), ".config");
}

/** Absolute path to `config.json` (honours XDG for tests/CI). */
export function configPath(): string {
  return join(configBaseDir(), CONFIG_DIR_NAME, CONFIG_FILE_NAME);
}

// ---------------------------------------------------------------------------
// OS keychain backend (macOS `security`), injectable + env-disable for tests.
// ---------------------------------------------------------------------------

/** Store for the API token, keyed by a fixed service/account pair. */
export interface KeychainBackend {
  get(): Promise<string | null>;
  set(secret: string): Promise<void>;
  remove(): Promise<void>;
}

function runSecurity(args: string[]): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    execFile("security", args, (error, stdout) => {
      const code = error
        ? ((error as Error & { code?: string | number }).code ?? 1)
        : 0;
      resolve({ stdout: stdout ?? "", code: typeof code === "number" ? code : 1 });
    });
  });
}

/**
 * macOS Keychain backed by the `security` CLI. The token is passed to
 * `security` via argv (its only non-interactive input path); this is a
 * local, short-lived process, and the token never touches our own argv.
 */
const macKeychain: KeychainBackend = {
  async get() {
    const { stdout, code } = await runSecurity([
      "find-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      KEYCHAIN_ACCOUNT,
      "-w",
    ]);
    if (code !== 0) {
      return null;
    }
    const value = stdout.replace(/\n$/, "");
    return value.length > 0 ? value : null;
  },
  async set(secret) {
    const { code } = await runSecurity([
      "add-generic-password",
      "-U", // update if it already exists
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      KEYCHAIN_ACCOUNT,
      "-w",
      secret,
    ]);
    if (code !== 0) {
      throw new AxiError(
        `Failed to write API token to macOS Keychain (security exit ${code})`,
        "UNKNOWN",
        [
          "Set ATLASSIAN_AXI_NO_KEYCHAIN=1 to store the token in the 0600 config file instead",
        ],
      );
    }
  },
  async remove() {
    await runSecurity([
      "delete-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      KEYCHAIN_ACCOUNT,
    ]);
  },
};

let injectedKeychain: KeychainBackend | null | undefined;

/**
 * Override the keychain backend for tests. Pass a fake to exercise the
 * keychain path, `null` to force the file-fallback path, or `undefined` to
 * restore platform auto-detection.
 */
export function setKeychainBackend(backend: KeychainBackend | null | undefined): void {
  injectedKeychain = backend;
}

/** Resolve the active keychain backend, or null when none is available. */
function getKeychain(): KeychainBackend | null {
  if (injectedKeychain !== undefined) {
    return injectedKeychain;
  }
  if (process.env["ATLASSIAN_AXI_NO_KEYCHAIN"]) {
    return null;
  }
  return platform() === "darwin" ? macKeychain : null;
}

// ---------------------------------------------------------------------------
// Config file I/O
// ---------------------------------------------------------------------------

function readStoredConfig(): StoredConfig {
  const path = configPath();
  if (!existsSync(path)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as StoredConfig;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // A corrupt file behaves like "not configured" rather than crashing.
    return {};
  }
}

/**
 * Atomic write (temp file + rename): read-merge-write callers race across
 * processes (the CLI's normal agent usage), and an in-place write torn by a
 * concurrent read would parse-fail into `{}` and silently drop the other
 * credential half on the next merge.
 */
function writeStoredConfig(config: StoredConfig): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
  const tmpPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, {
    mode: FILE_MODE,
  });
  // writeFileSync only applies mode when creating; enforce 0600 on rewrite too.
  chmodSync(tmpPath, FILE_MODE);
  renameSync(tmpPath, path);
}

// ---------------------------------------------------------------------------
// Resolution (env > keychain/config) + persistence
// ---------------------------------------------------------------------------

function envValue(name: string): string | undefined {
  const raw = process.env[name];
  return raw && raw.trim() !== "" ? raw.trim() : undefined;
}

/**
 * Strip any scheme/trailing slash so we always hold a bare host. Applied at
 * resolution time (not just `auth login`) because ATLASSIAN_SITE=https://...
 * would otherwise reach URL building raw and parse to host "https".
 */
export function normalizeSite(site: string | undefined): string | undefined {
  if (!site) {
    return undefined;
  }
  const bare = site
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  return bare === "" ? undefined : bare;
}

/**
 * Resolve the credential with env winning over persisted state:
 *   site   : ATLASSIAN_SITE       > config.site
 *   email  : ATLASSIAN_EMAIL      > config.email
 *   token  : ATLASSIAN_API_TOKEN  > keychain > config.token
 */
export async function resolveCredential(): Promise<ResolvedCredential> {
  const stored = readStoredConfig();
  const resolved: ResolvedCredential = { sources: {} };

  const envSite = normalizeSite(envValue("ATLASSIAN_SITE"));
  const storedSite = normalizeSite(stored.site);
  if (envSite) {
    resolved.site = envSite;
    resolved.sources.site = "env";
  } else if (storedSite) {
    resolved.site = storedSite;
    resolved.sources.site = "config";
  }

  const envEmail = envValue("ATLASSIAN_EMAIL");
  if (envEmail) {
    resolved.email = envEmail;
    resolved.sources.email = "env";
  } else if (stored.email) {
    resolved.email = stored.email;
    resolved.sources.email = "config";
  }

  // Every read path goes through sanitizeToken so a quote-wrapped value in
  // the env, keychain, or config file (the original confl404 corruption) is
  // repaired at resolution time, not just at `auth login`. Deliberately
  // non-throwing: resolveCredential runs before login can replace a truly
  // mangled token, and the REST error hints now cover that case.
  const envToken = sanitizeToken(envValue("ATLASSIAN_API_TOKEN") ?? "");
  if (envToken) {
    resolved.apiToken = envToken;
    resolved.sources.apiToken = "env";
  } else {
    const keychain = getKeychain();
    const fromKeychain = sanitizeToken((keychain ? await keychain.get() : null) ?? "");
    if (fromKeychain) {
      resolved.apiToken = fromKeychain;
      resolved.sources.apiToken = "keychain";
    } else {
      const fromFile = sanitizeToken(stored.token ?? "");
      if (fromFile) {
        resolved.apiToken = fromFile;
        resolved.sources.apiToken = "config";
      }
    }
  }

  return resolved;
}

/** Throw a friendly AUTH_REQUIRED error naming the missing pieces. */
export function authRequiredError(missing: string[]): AxiError {
  return new AxiError(
    `Not authenticated (missing: ${missing.join(", ")})`,
    "AUTH_REQUIRED",
    [
      "Run `atlassian-axi auth login` for the OAuth browser flow (interactive terminals)",
      "Or run `atlassian-axi auth login --token --site <site> --email <email>` and pipe your API token via stdin",
      "Or set ATLASSIAN_SITE / ATLASSIAN_EMAIL / ATLASSIAN_API_TOKEN",
    ],
  );
}

/** Resolve a complete credential or throw AUTH_REQUIRED listing what's absent. */
export async function requireCredential(): Promise<AtlassianCredential> {
  const resolved = await resolveCredential();
  const missing: string[] = [];
  if (!resolved.site) missing.push("site");
  if (!resolved.email) missing.push("email");
  if (!resolved.apiToken) missing.push("apiToken");
  if (missing.length > 0) {
    throw authRequiredError(missing);
  }
  return {
    site: resolved.site as string,
    email: resolved.email as string,
    apiToken: resolved.apiToken as string,
  };
}

/**
 * Persist a credential: `{site,email}` always to the 0600 config file; the
 * token to the OS keychain when available, else to the same 0600 file.
 */
export async function saveCredential(
  credential: AtlassianCredential,
): Promise<{ tokenStore: "keychain" | "file" }> {
  // Merge with the stored config so an API-token login never clobbers an
  // existing OAuth session (and vice versa — see saveOAuthSession).
  const stored = readStoredConfig();
  const keychain = getKeychain();
  if (keychain) {
    try {
      await keychain.set(credential.apiToken);
      const next: StoredConfig = {
        ...stored,
        site: credential.site,
        email: credential.email,
      };
      // The token lives in the keychain now; a stale file token would shadow
      // rotations, so drop it explicitly.
      delete next.token;
      writeStoredConfig(next);
      return { tokenStore: "keychain" };
    } catch {
      // Keychain unavailable/locked at runtime; fall back to the 0600 file path.
    }
  }
  writeStoredConfig({
    ...stored,
    site: credential.site,
    email: credential.email,
    token: credential.apiToken,
  });
  return { tokenStore: "file" };
}

// ---------------------------------------------------------------------------
// OAuth session persistence + auth-mode resolution
// ---------------------------------------------------------------------------

/**
 * Read the persisted OAuth session, or null when absent/malformed. A session
 * missing any required field is treated as "not logged in" rather than
 * crashing every command — `auth login` rewrites it whole.
 */
export function readOAuthSession(): OAuthSession | null {
  const oauth = readStoredConfig().oauth;
  if (!oauth || typeof oauth !== "object") {
    return null;
  }
  const required: (keyof OAuthSession)[] = [
    "clientId",
    "accessToken",
    "refreshToken",
    "cloudId",
    "site",
  ];
  for (const key of required) {
    if (typeof oauth[key] !== "string" || oauth[key] === "") {
      return null;
    }
  }
  if (typeof oauth.expiresAt !== "number") {
    return null;
  }
  // Optional fields are sanitised rather than trusted: a corrupted non-string
  // clientSecret must never flow into a token request body.
  return {
    clientId: oauth.clientId,
    accessToken: oauth.accessToken,
    refreshToken: oauth.refreshToken,
    expiresAt: oauth.expiresAt,
    cloudId: oauth.cloudId,
    site: oauth.site,
    scopes: typeof oauth.scopes === "string" ? oauth.scopes : "",
    ...(typeof oauth.clientSecret === "string" && oauth.clientSecret !== ""
      ? { clientSecret: oauth.clientSecret }
      : {}),
  };
}

/** Persist the OAuth session (whole-object write; preserves site/email/token). */
export function saveOAuthSession(session: OAuthSession): void {
  const stored = readStoredConfig();
  writeStoredConfig({ ...stored, oauth: session });
}

/** Drop only the OAuth session, keeping any API-token credential intact. */
export function clearOAuthSession(): void {
  const stored = readStoredConfig();
  if (!stored.oauth) {
    return;
  }
  const rest = { ...stored };
  delete rest.oauth;
  writeStoredConfig(rest);
}

/**
 * Resolve the OAuth client secret: env `ATLASSIAN_AXI_OAUTH_CLIENT_SECRET`
 * wins over the secret stored with the session (written on first login).
 * Both read paths run through `sanitizeToken` — the secret is human-pasted
 * exactly like the API token, so the same quote-wrapping corruption applies.
 */
export function resolveOAuthClientSecret(
  session?: OAuthSession | null,
): { secret: string; source: "env" | "config" } | null {
  const env = sanitizeToken(envValue("ATLASSIAN_AXI_OAUTH_CLIENT_SECRET") ?? "");
  if (env) {
    return { secret: env, source: "env" };
  }
  const stored = session ?? readOAuthSession();
  const fromStore = sanitizeToken(stored?.clientSecret ?? "");
  if (fromStore) {
    return { secret: fromStore, source: "config" };
  }
  return null;
}

/**
 * Which auth mode drives the Confluence REST half. Resolution order
 * (documented in `auth --help`):
 *   1. `ATLASSIAN_API_TOKEN` env (an explicit agent/CI override) — API-token
 *      mode; if site/email are missing this is a loud config error, never a
 *      silent fallback to OAuth.
 *   2. A persisted OAuth session — OAuth (Bearer via api.atlassian.com) mode.
 *   3. A complete stored API-token credential — API-token mode.
 */
export type AuthMode =
  | { mode: "oauth"; oauth: OAuthSession }
  | {
      mode: "api-token";
      credential: AtlassianCredential;
      sources: ResolvedCredential["sources"];
    }
  | { mode: "none"; missing: string[] };

export async function resolveAuthMode(): Promise<AuthMode> {
  const resolved = await resolveCredential();
  const complete = Boolean(resolved.site && resolved.email && resolved.apiToken);
  const tokenMode = (): AuthMode => ({
    mode: "api-token",
    credential: {
      site: resolved.site as string,
      email: resolved.email as string,
      apiToken: resolved.apiToken as string,
    },
    sources: resolved.sources,
  });

  if (resolved.sources.apiToken === "env") {
    if (complete) {
      return tokenMode();
    }
    const missing = [
      !resolved.site ? "site" : null,
      !resolved.email ? "email" : null,
    ].filter((v): v is string => v !== null);
    return { mode: "none", missing };
  }

  const oauth = readOAuthSession();
  if (oauth) {
    return { mode: "oauth", oauth };
  }
  if (complete) {
    return tokenMode();
  }
  const missing: string[] = [];
  if (!resolved.site) missing.push("site");
  if (!resolved.email) missing.push("email");
  if (!resolved.apiToken) missing.push("apiToken");
  return { mode: "none", missing };
}

/** Resolve an active auth mode or throw AUTH_REQUIRED naming both login paths. */
export async function requireAuth(): Promise<Exclude<AuthMode, { mode: "none" }>> {
  const mode = await resolveAuthMode();
  if (mode.mode === "none") {
    throw new AxiError(
      `Not authenticated (missing: ${mode.missing.join(", ")})`,
      "AUTH_REQUIRED",
      [
        "Run `atlassian-axi auth login` for the OAuth browser flow (interactive terminals)",
        "Or `echo -n \"<token>\" | atlassian-axi auth login --token --site <site> --email <email>` (agents/CI)",
      ],
    );
  }
  return mode;
}

/**
 * Whether this invocation can drive a browser login: both stdin and stdout
 * must be interactive terminals. Agents/CI pipe at least one of them — the
 * OAuth flow must fail fast there instead of hanging on a browser.
 */
export function isInteractiveTTY(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/** Remove all persisted state: delete the config file and keychain token. */
export async function clearCredential(): Promise<void> {
  const path = configPath();
  if (existsSync(path)) {
    rmSync(path, { force: true });
  }
  const keychain = getKeychain();
  if (keychain) {
    try {
      await keychain.remove();
    } catch {
      // Nothing stored / already removed — clearing is best-effort.
    }
  }
}

// ---------------------------------------------------------------------------
// Token from stdin (never argv; TTY throws — mirrors gh-axi's secret handling)
// ---------------------------------------------------------------------------

/** Whether stdin is an interactive terminal (no piped input available). */
export function isStdinTTY(): boolean {
  return Boolean(process.stdin.isTTY);
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function tokenRequiredError(): AxiError {
  return new AxiError(
    "API token is required: pipe it via stdin (never passed as an argument)",
    "VALIDATION_ERROR",
    [
      `echo -n "<token>" | atlassian-axi auth login --token --site <site> --email <email>`,
    ],
  );
}

/**
 * Normalize a piped token: trim, then strip ONE pair of matching surrounding
 * quotes. A quote-wrapped paste (e.g. a JSON value copied without `jq -r`)
 * otherwise reaches the keychain verbatim and every REST call fails —
 * Confluence v2 answers the resulting anonymous request with 404, which reads
 * as a URL bug instead of a credential bug.
 */
export function sanitizeToken(raw: string): string {
  const trimmed = raw.trim();
  const wrapped = trimmed.match(/^(["'])(.*)\1$/s);
  return wrapped ? (wrapped[2] as string).trim() : trimmed;
}

/**
 * Read the API token from stdin. Throws (never blocks) on an interactive TTY,
 * rejects an empty pipe, strips one pair of surrounding quotes, and rejects
 * tokens carrying internal whitespace or control characters (a real Atlassian
 * API token has neither — their presence means a mangled paste). The token is
 * only ever read here — never from a CLI flag/argv.
 */
export async function readTokenFromStdin(): Promise<string> {
  if (isStdinTTY()) {
    throw tokenRequiredError();
  }
  const value = sanitizeToken(await readStdin());
  if (value.length === 0) {
    throw tokenRequiredError();
  }
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(value)) {
    throw new AxiError(
      "API token contains whitespace or control characters — it looks mangled (quoted, wrapped, or multi-line paste)",
      "VALIDATION_ERROR",
      [
        "Copy the raw token value and re-pipe it: echo -n \"<token>\" | atlassian-axi auth login",
      ],
    );
  }
  return value;
}
