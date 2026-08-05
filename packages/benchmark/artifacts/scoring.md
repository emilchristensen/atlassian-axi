# Scoring: accuracy runs against pre-declared expectations

Separate pass over the committed transcripts in `artifacts/transcripts/`, scored only against `artifacts/expectations.md` (rating scale defined there).
The scorer read transcripts and expectations; it executed nothing.
Scored 2026-08-05, after the transcripts were committed (`git log` on this directory shows the ordering).

Every MCP cell is `not-rated`: the Atlassian Rovo MCP server requires interactive OAuth that could not be completed in this environment (unauthenticated `tools/list` returned HTTP 401 on 2026-08-05).
The accuracy comparison therefore covers two of the three surfaces.

## Per-task ratings

| Task | jira-axi / confluence-axi | acli | MCP |
|---|---|---|---|
| A-J1 view work item | correct | correct | not-rated |
| A-J2 read comments | correct | correct | not-rated |
| A-J3 JQL search | correct | correct | not-rated |
| A-J4 transition (plan-only) | correct | correct | not-rated |
| A-J5 add comment (plan-only) | correct | correct | not-rated |
| A-C1 read page | correct | correct | not-rated |
| A-C2 CQL search | correct | correct (correctly proved CQL unsupported; also reached the goal via tree traversal) | not-rated |
| A-C3 list children | correct | correct | not-rated |
| A-C4 list labels | correct | correct | not-rated |
| A-C5 list attachments | correct | correct (correctly proved unsupported; attachment list itself not obtainable) | not-rated |
| A-C6 create page (plan-only) | correct | correct (correctly proved unsupported) | not-rated |
| A-C7 update page (plan-only) | correct | correct (correctly proved unsupported) | not-rated |

## Aggregates

| Surface | correct | correct-with-retries | wrong | unable | not-rated |
|---|---|---|---|---|---|
| jira-axi (5 tasks) | 5 | 0 | 0 | 0 | 0 |
| confluence-axi (7 tasks) | 7 | 0 | 0 | 0 | 0 |
| acli (12 tasks) | 12 | 0 | 0 | 0 | 0 |
| MCP (12 tasks) | 0 | 0 | 0 | 0 | 12 |

## Scoring notes

- Per the pre-declared scale, an acli run that correctly proves an operation unsupported scores `correct` (right behavior on that surface), but the underlying task output is still not produced.
  On the Confluence task set, acli produced the requested result on 3 of 7 tasks directly (A-C1, A-C3, A-C4), reached the A-C2 goal only via a recursive tree-traversal workaround, and could not produce the result at all on A-C5, A-C6, A-C7.
  confluence-axi produced the requested result on 7 of 7.
- A-J2/A-C3/A-C4 acli runs used the syntaxes from the pre-run amendment in `expectations.md` (`comment list --key`, include flags with `--json`); the operation choice matched the original expectation in every case.
- A-C1 acli needed two view invocations (the default rendering omits the body; the agent added `--body-format storage --json`).
  No invocation failed or used a wrong parameter, so this stays `correct` rather than `correct-with-retries`.
- Accuracy did not separate the two drivable surfaces; the separation shows in effort: per `runs-metadata.json` (measured), the Jira task set took 5 executor commands total on jira-axi vs 25 on acli, and the Confluence set 6 on confluence-axi vs 51 on acli, with correspondingly longer wall-clock times.
- Each cell is a single run (n=1) with one executor model (claude-fable-5); treat the aggregate as indicative, not statistical.
