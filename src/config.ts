import { execFile } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
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

interface StoredConfig {
  site?: string;
  email?: string;
  /** Present only in the file-fallback path (no OS keychain available). */
  token?: string;
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

function writeStoredConfig(config: StoredConfig): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: FILE_MODE });
  // writeFileSync only applies mode when creating; enforce 0600 on rewrite too.
  chmodSync(path, FILE_MODE);
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

  const envToken = envValue("ATLASSIAN_API_TOKEN");
  if (envToken) {
    resolved.apiToken = envToken;
    resolved.sources.apiToken = "env";
  } else {
    const keychain = getKeychain();
    const fromKeychain = keychain ? await keychain.get() : null;
    if (fromKeychain) {
      resolved.apiToken = fromKeychain;
      resolved.sources.apiToken = "keychain";
    } else if (stored.token) {
      resolved.apiToken = stored.token;
      resolved.sources.apiToken = "config";
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
      "Run `atlassian-axi auth login --site <site> --email <email>` and pipe your API token via stdin",
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
  const keychain = getKeychain();
  if (keychain) {
    try {
      await keychain.set(credential.apiToken);
      writeStoredConfig({ site: credential.site, email: credential.email });
      return { tokenStore: "keychain" };
    } catch {
      // Keychain unavailable/locked at runtime; fall back to the 0600 file path.
    }
  }
  writeStoredConfig({
    site: credential.site,
    email: credential.email,
    token: credential.apiToken,
  });
  return { tokenStore: "file" };
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
    [`echo -n "<token>" | atlassian-axi auth login --site <site> --email <email>`],
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
