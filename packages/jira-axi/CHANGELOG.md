# Changelog

## [1.0.1](https://github.com/emilchristensen/atlassian-axi/compare/jira-axi-v1.0.0...jira-axi-v1.0.1) (2026-07-23)


### Bug Fixes

* **confluence-axi:** carry --site into error suggestions, add --fields, enrich dashboard ([#55](https://github.com/emilchristensen/atlassian-axi/issues/55)) ([8ac9f8b](https://github.com/emilchristensen/atlassian-axi/commit/8ac9f8b66346803257e3814cc19f22d02eb7a173))
* fail loud on unknown CLI flags and disclose implicit query scope ([#54](https://github.com/emilchristensen/atlassian-axi/issues/54)) ([7672fb4](https://github.com/emilchristensen/atlassian-axi/commit/7672fb497937a29368d2eb4cf48f893c754851db))
* **jira-axi:** bound and count comments, truncate all detail descriptions ([#47](https://github.com/emilchristensen/atlassian-axi/issues/47)) ([81adc86](https://github.com/emilchristensen/atlassian-axi/commit/81adc86c77ab75f970d844887f8086cacb74d0f6))
* **jira-axi:** tighten home description and make workitem edit suggestion additive ([#56](https://github.com/emilchristensen/atlassian-axi/issues/56)) ([b0d37d4](https://github.com/emilchristensen/atlassian-axi/commit/b0d37d483222880f6f279feaefe08971ab4c84d1))
* scope `page <sub> --help` output and report partial hook installs ([#46](https://github.com/emilchristensen/atlassian-axi/issues/46)) ([e2d3b8b](https://github.com/emilchristensen/atlassian-axi/commit/e2d3b8b0354f1a12e5ebce0960ce81ea9862c020))

## [1.0.0](https://github.com/emilchristensen/atlassian-axi/compare/jira-axi-v0.2.1...jira-axi-v1.0.0) (2026-07-22)


### Bug Fixes

* **jira-axi,core:** harden acli transport, ADF conversion, and command inputs ([f8fa3de](https://github.com/emilchristensen/atlassian-axi/commit/f8fa3defd14cc3878a962fb8aefd9c19735fb0c0))

## [0.2.1](https://github.com/emilchristensen/atlassian-axi/compare/jira-axi-v0.2.0...jira-axi-v0.2.1) (2026-07-22)


### Bug Fixes

* **confluence-axi:** harden auth, transport, and command inputs ([a650f55](https://github.com/emilchristensen/atlassian-axi/commit/a650f55db9bb80b59dc3aa247625edc7a0cbe105))
* **confluence-axi:** harden auth, transport, and command inputs ([cbf154d](https://github.com/emilchristensen/atlassian-axi/commit/cbf154d701fae0539ed987cef2aaeabe3d0c5de9))

## 0.2.0 (2026-07-21)


### Features

* **jira-axi:** wire jira-axi to green; fix confluence-axi bin double-shebang ([9c83ffc](https://github.com/emilchristensen/atlassian-axi/commit/9c83ffc8a3dcaa5cde28487468725131812e4628))


### Bug Fixes

* drop source shebang in confluence-axi bin (tsup banner adds one; ([9c83ffc](https://github.com/emilchristensen/atlassian-axi/commit/9c83ffc8a3dcaa5cde28487468725131812e4628))
* **jira-axi:** surface acli batch-mutation failures instead of silent success ([d6c6b24](https://github.com/emilchristensen/atlassian-axi/commit/d6c6b240913e236dc530930d3b805c62cfb9949f))
