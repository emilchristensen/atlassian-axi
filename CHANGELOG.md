# Changelog

## [0.1.2](https://github.com/emilchristensen/atlassian-axi/compare/atlassian-axi-v0.1.1...atlassian-axi-v0.1.2) (2026-07-19)


### Bug Fixes

* unblock npm publish (token wiring + bin path normalization) ([bfbfc5a](https://github.com/emilchristensen/atlassian-axi/commit/bfbfc5a31936343e80db8253c5098085e8928d5b))

## [0.1.1](https://github.com/emilchristensen/atlassian-axi/compare/atlassian-axi-v0.1.0...atlassian-axi-v0.1.1) (2026-07-19)


### Features

* convert markdown Jira bodies to ADF by default ([#11](https://github.com/emilchristensen/atlassian-axi/issues/11)) ([aa5bc4a](https://github.com/emilchristensen/atlassian-axi/commit/aa5bc4a3eaca5f777b22a37c5ac662b18763d1f8))
* guard confluence page update against dropping embedded macros ([c0602aa](https://github.com/emilchristensen/atlassian-axi/commit/c0602aae74d440b0130ce03dd0253a322488ac34))
* OAuth 2.0 (3LO) browser login as the default auth flow ([#9](https://github.com/emilchristensen/atlassian-axi/issues/9)) ([c513753](https://github.com/emilchristensen/atlassian-axi/commit/c5137538a9b4a7c1df23ed769a9fd61c588272e2))
* Phase 1 - auth + config ([17c748d](https://github.com/emilchristensen/atlassian-axi/commit/17c748dd33a126ee034045180ac308cb65043346))
* Phase 1 auth + config (unified credential, acli shell-out, auth commands) ([7fd468a](https://github.com/emilchristensen/atlassian-axi/commit/7fd468a24acabb191abc46fd3de626e17007f6e2))
* Phase 2 Jira MVP (workitem + project via acli) ([#3](https://github.com/emilchristensen/atlassian-axi/issues/3)) ([c0b9451](https://github.com/emilchristensen/atlassian-axi/commit/c0b94511afe5b83508438eed17eccfc5db23890e))
* Phase 3 Confluence MVP (page/space/search via direct REST) ([#4](https://github.com/emilchristensen/atlassian-axi/issues/4)) ([4d3836a](https://github.com/emilchristensen/atlassian-axi/commit/4d3836affe2ddb494955bc8aa7ab187e9d899ef0))
* Phase 4a Jira breadth (board/sprint/filter/dashboard/field via acli) ([#5](https://github.com/emilchristensen/atlassian-axi/issues/5)) ([a1bd930](https://github.com/emilchristensen/atlassian-axi/commit/a1bd9308ec641567583dd30d9361120a2ffd33ad))
* Phase 4b Confluence breadth + polish (attachments/labels/children, view --fields, suggestions parity) ([#6](https://github.com/emilchristensen/atlassian-axi/issues/6)) ([eab9559](https://github.com/emilchristensen/atlassian-axi/commit/eab955961121e556ace938c64f88bcdd59509d53))
* scaffold atlassian-axi Phase 0 skeleton ([19e33ee](https://github.com/emilchristensen/atlassian-axi/commit/19e33ee68f8323f55a4a21703945d796e6c7a3c1))
* scaffold atlassian-axi Phase 0 skeleton ([6406b06](https://github.com/emilchristensen/atlassian-axi/commit/6406b063ef59d0c803ed1a43b306a830dced5520))


### Bug Fixes

* exit 2 on unknown resources/subcommands, bump version to 0.1.0 ([#8](https://github.com/emilchristensen/atlassian-axi/issues/8)) ([d207882](https://github.com/emilchristensen/atlassian-axi/commit/d20788250c7f37a5abee5c81d826e6beadce8044))
* harden auth against mangled tokens and misleading Confluence 404s ([#10](https://github.com/emilchristensen/atlassian-axi/issues/10)) ([8c370f5](https://github.com/emilchristensen/atlassian-axi/commit/8c370f539f576f8dfe1313eaa1f26c9902dea692))
* harden CLI ergonomics from live E2E sweep findings ([#12](https://github.com/emilchristensen/atlassian-axi/issues/12)) ([a1b2e2b](https://github.com/emilchristensen/atlassian-axi/commit/a1b2e2b70069b365e94e9c6897b0077fdf227dee))
* honour --site end-to-end and Confluence trash semantics ([a0a2a1f](https://github.com/emilchristensen/atlassian-axi/commit/a0a2a1f07a4df8dd0a3f23ae6cc0aca786afec8c))
* repair syntax mangled by applied review suggestions ([82dc821](https://github.com/emilchristensen/atlassian-axi/commit/82dc8210887d8227f9a719bbb7af4d5049d05764))
