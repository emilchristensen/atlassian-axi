#!/usr/bin/env bash
#
# install-from-fork.sh — build the security-hardened Marl0nL/atlassian-axi fork
# from source and install both published CLIs globally, from local tarballs
# (never from npm). One-shot equivalent of docs/INSTALL-FROM-FORK.md.
#
# Usage:
#   scripts/install-from-fork.sh            # build + pack + global install
#
# Requirements: git checkout of this fork, Node >= 20, pnpm, and npm (for the
# global install). jira-axi additionally needs Atlassian's `acli` at runtime
# (see the note printed at the end); confluence-axi needs env-var auth.

set -euo pipefail

# Resolve the repo root from this script's location so it runs from anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PACKAGES=(jira-axi confluence-axi)

echo "==> Fork install from: $REPO_ROOT"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "error: pnpm is not on PATH. Install it (e.g. 'corepack enable pnpm') and re-run." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "error: npm is not on PATH (needed for the global install)." >&2
  exit 1
fi

echo "==> pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile

echo "==> pnpm build"
pnpm build

# Pack each published package into a tarball, then install that tarball
# globally. Packing first (rather than 'npm i -g <dir>') installs exactly the
# published 'files' set and pins the exact built version.
TARBALLS=()
PACK_DIR="$(mktemp -d)"
trap 'rm -rf "$PACK_DIR"' EXIT

for pkg in "${PACKAGES[@]}"; do
  echo "==> npm pack $pkg"
  # `npm pack --json` prints the produced filename; capture it robustly.
  tarball_name="$(cd "packages/$pkg" && npm pack --pack-destination "$PACK_DIR" --json | python3 -c 'import sys,json; print(json.load(sys.stdin)[0]["filename"])')"
  TARBALLS+=("$PACK_DIR/$tarball_name")
done

echo "==> npm install -g <tarballs>"
npm install -g "${TARBALLS[@]}"

echo ""
echo "==> Installed versions:"
for pkg in "${PACKAGES[@]}"; do
  if command -v "$pkg" >/dev/null 2>&1; then
    printf '    %-16s %s  (%s)\n' "$pkg" "$("$pkg" --version 2>/dev/null || echo '?')" "$(command -v "$pkg")"
  else
    echo "    $pkg: NOT on PATH after install — check your npm global bin dir is on PATH" >&2
  fi
done

cat <<'NOTE'

==> Next steps (auth is NOT set up by this script):
  jira-axi        Requires Atlassian's acli at runtime:
                    brew install acli    (or see https://developer.atlassian.com/cloud/acli/)
                    acli jira auth login
  confluence-axi  Uses env-var auth (recommended for agents/CI):
                    export ATLASSIAN_SITE=your-site.atlassian.net
                    export ATLASSIAN_EMAIL=you@example.com
                    export ATLASSIAN_API_TOKEN=...        # from id.atlassian.com

Verify: `jira-axi --help` and `confluence-axi --help`.
Do NOT run these CLIs via npx, and do NOT run their `update` command — this fork
is installed from source and pinned deliberately.
NOTE
