# Changelog

## [1.0.1](https://github.com/emilchristensen/atlassian-axi/compare/confluence-axi-v1.0.0...confluence-axi-v1.0.1) (2026-07-23)


### Bug Fixes

* **confluence-axi:** carry --site into error suggestions, add --fields, enrich dashboard ([#55](https://github.com/emilchristensen/atlassian-axi/issues/55)) ([8ac9f8b](https://github.com/emilchristensen/atlassian-axi/commit/8ac9f8b66346803257e3814cc19f22d02eb7a173))
* fail loud on unknown CLI flags and disclose implicit query scope ([#54](https://github.com/emilchristensen/atlassian-axi/issues/54)) ([7672fb4](https://github.com/emilchristensen/atlassian-axi/commit/7672fb497937a29368d2eb4cf48f893c754851db))
* scope `page <sub> --help` output and report partial hook installs ([#46](https://github.com/emilchristensen/atlassian-axi/issues/46)) ([e2d3b8b](https://github.com/emilchristensen/atlassian-axi/commit/e2d3b8b0354f1a12e5ebce0960ce81ea9862c020))

## 1.0.0 (2026-07-22)


### Features

* **confluence-axi,core:** wire confluence-axi + core to green ([e5efd53](https://github.com/emilchristensen/atlassian-axi/commit/e5efd530c9ce6d4cde6845b64b36736f9580fc33))
* **jira-axi:** wire jira-axi to green; fix confluence-axi bin double-shebang ([9c83ffc](https://github.com/emilchristensen/atlassian-axi/commit/9c83ffc8a3dcaa5cde28487468725131812e4628))


### Bug Fixes

* **confluence-axi:** harden auth, transport, and command inputs ([a650f55](https://github.com/emilchristensen/atlassian-axi/commit/a650f55db9bb80b59dc3aa247625edc7a0cbe105))
* **confluence-axi:** harden auth, transport, and command inputs ([cbf154d](https://github.com/emilchristensen/atlassian-axi/commit/cbf154d701fae0539ed987cef2aaeabe3d0c5de9))
* drop source shebang in confluence-axi bin (tsup banner adds one; ([9c83ffc](https://github.com/emilchristensen/atlassian-axi/commit/9c83ffc8a3dcaa5cde28487468725131812e4628))
