# Install from this fork (from source)

This is the security-hardened `Marl0nL/atlassian-axi` fork. It is installed
**from source**, never from npm and never via `npx`. The published packages
(`jira-axi`, `confluence-axi`) are built locally, packed into tarballs, and
installed globally so the binaries resolve on your `PATH`.

Agents must invoke the installed `jira-axi` / `confluence-axi` binaries
directly, never `npx ...@latest`, and must never run the built-in `update`
command (it self-updates to `@latest` from npm, bypassing this review gate).

## One-shot

```
git clone https://github.com/Marl0nL/atlassian-axi
cd atlassian-axi
scripts/install-from-fork.sh
```

The script builds the fork, packs each published package, installs both CLIs
globally, and prints the installed versions and their resolved paths.

## Manual steps

If you prefer to run it by hand (this is exactly what the script does):

```
git clone https://github.com/Marl0nL/atlassian-axi
cd atlassian-axi

pnpm install --frozen-lockfile
pnpm build

# Pack the published set for each package into a tarball...
( cd packages/jira-axi       && npm pack )
( cd packages/confluence-axi && npm pack )

# ...then install those tarballs globally (adjust versions in the filenames):
npm install -g packages/jira-axi/jira-axi-*.tgz packages/confluence-axi/confluence-axi-*.tgz

# Verify:
jira-axi --help
confluence-axi --help
```

## Requirements

- **Node** >= 20, **pnpm**, and **npm** (for the global install).
- **jira-axi** shells out to Atlassian's `acli` at runtime — it holds no
  credentials of its own:
  ```
  brew install acli          # or see https://developer.atlassian.com/cloud/acli/
  acli jira auth login
  ```
- **confluence-axi** authenticates to the Confluence Cloud REST API. For
  agents/CI, use env-var auth:
  ```
  export ATLASSIAN_SITE=your-site.atlassian.net
  export ATLASSIAN_EMAIL=you@example.com
  export ATLASSIAN_API_TOKEN=...      # create at https://id.atlassian.com/manage-profile/security/api-tokens
  ```
  (OAuth 3LO is the interactive/human path and needs a self-registered app; see
  [`packages/confluence-axi/docs/getting-started.md`](../packages/confluence-axi/docs/getting-started.md).)

## Keeping the fork current

Upstream (`emilchristensen/atlassian-axi`) syncs are **review-gated**: pull
upstream changes onto a branch, review the diff (especially credential/auth
paths, the workflows, and each `SKILL.md`), then merge and re-run
`scripts/install-from-fork.sh`. Do not point installs at upstream or at npm.
