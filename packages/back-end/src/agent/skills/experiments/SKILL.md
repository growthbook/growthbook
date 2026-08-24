---
name: experiments
description: Shared conventions behind the experiment-* skills — the GET /experiments filter and sort reference, identifier and linking rules, page-context mapping, which mutations are gated, and how to report Bayesian results. Load it alongside the experiment-* skill you are following; it documents no workflow of its own.
---

# Experiments

Background for the `experiment-*` skills. Use `callApi` for all REST calls under
`/api/v1/experiments`.

The workflow lives in whichever `experiment-*` skill matches the request — load
that one directly. Load this alongside it when you need the conventions below.

For **product analytics charts** (metric/fact-table explorations), call
`loadSkill('product-analytics')` instead — not covered here.

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
  `result` (`won` | `lost` | `inconclusive` | `dnf` — the recorded result,
  retained even if the experiment is restarted), `implementationType`
  (`feature` | `visualChange` | `redirect` — the linked-change kind, not the
  response's `type` field), `metricId`, `bandits` (`true` | `false`), and
  `archived` (`true` | `false`; omit for both). `tag`, `owner`, `result`,
  `implementationType`, and `metricId` take comma-separated values, ORed
  within a param;
  separate params AND together. Sort with `sortBy`
  (`dateCreated` | `dateUpdated` | `name`) + `sortOrder` (default is
  `dateCreated` ascending — oldest first). Filter and sort API-side instead
  of pulling pages and filtering by hand.
- **Identifiers:** reference experiments by **name** in replies; use `id` for
  API calls and `/experiment/<id>` links.
- **Results:** cite numbers from `GET .../results`; do not fabricate uplift.
- **Draft experiments:** no results until launched — say so clearly.
- **Bayesian default:** report Chance to Win + credible intervals, not p-values.
