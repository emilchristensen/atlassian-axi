import { defineConfig } from "tsup";

// Bundles the private @atlassian-axi/core package (and @toon-format/toon) into
// the CLI so the published package is self-contained; axi-sdk-js stays an
// external runtime dependency.
export default defineConfig({
  entry: { "bin/jira-axi": "src/bin/jira-axi.ts" },
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  banner: { js: "#!/usr/bin/env node" },
  noExternal: [/@atlassian-axi\/core/, /@toon-format\/toon/],
});
