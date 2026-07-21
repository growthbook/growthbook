---
name: experiments
description: Read and modify experiments (A/B tests), snapshots, and results. Use when the user asks about experiments, hypotheses, variations, goal/guardrail metrics, launching or stopping tests, or page context under /experiment/*.
---

# Experiments

Domain router for experiments. Use `callApi` for all REST calls under
`/api/v1/experiments`.

**Workflow:** read this router → `loadSkill('<leaf>')` for the matching
sub-skill below → follow that leaf's workflow.

For **product analytics charts** (metric/fact-table explorations), call
`loadSkill('product-analytics')` instead — not covered here.

## Sub-skills

| Skill                   | Use when                                      |
| ----------------------- | --------------------------------------------- |
| `experiment-brainstorm` | Exploring ideas before a formal design        |
| `experiment-design`     | Designing hypothesis, metrics, and variations |
| `experiment-launch`     | End-to-end create + flag wire-up + start      |
| `experiment-analyze`    | Fetching and interpreting results (read-only) |
| `experiment-stop`       | Stopping a running experiment with a winner   |

## Page context

When the user message starts with `[Page context: <path>]`:

- `/experiment/<id>` → that experiment (`GET .../experiments/<id>` or
  `GET .../results` for outcomes).
- `/experiments` → list/browse.
- `/metric/<id>` or `/fact-metrics/<id>` → metric entity; use
  `product-analytics` if the user wants a chart.

## Shared conventions

- **Mutations:** non-GET `callApi` calls are gated except
  `POST .../snapshot` (results refresh — runs immediately).
- **List filtering/sorting:** `GET /api/v1/experiments` filters by `q` (the
  app's search syntax plus free text — rejects `!` and operators with a 400),
  `projectId`, `status` (`draft` | `running` | `stopped`), `tag`, `owner`,
  `result` (`won` | `lost` | `inconclusive` | `dnf`), `type` (`feature` |
  `visualChange` | `redirect`), `metricId`, `bandits` (`true` | `false`), and
  `archived` (`true` | `false`; omit for both). `tag`, `owner`, `result`,
  `type`, and `metricId` take comma-separated values, ORed within a param;
  separate params AND together. Sort with `sortBy`
  (`dateCreated` | `dateUpdated` | `name`) + `sortOrder` (default is
  `dateCreated` ascending — oldest first). Filter and sort API-side instead
  of pulling pages and filtering by hand.
- **Identifiers:** reference experiments by **name** in replies; use `id` for
  API calls and `/experiment/<id>` links.
- **Results:** cite numbers from `GET .../results`; do not fabricate uplift.
- **Draft experiments:** no results until launched — say so clearly.
- **Bayesian default:** report Chance to Win + credible intervals, not p-values.
