---
name: dashboards
description: Build and edit Analytics dashboards. Use when the user asks to build, create, or change a dashboard, save charts together on a page, or page context under /product-analytics/dashboards/*.
---

# Dashboards

Domain router for Analytics dashboards. Use `callApi` for all REST calls.
Dashboard endpoints are `/api/v1/dashboards`; the product analytics lookups a
dashboard is built from are `/api/v1/product-analytics/*`.

**Workflow:** read this router → `loadSkill('dashboards/references/<leaf>')` for the matching
sub-skill below → follow that leaf's workflow.

Both leaves end the same way: one `proposeDashboard` call, which runs every
chart, lays out the grid, and shows the user a live preview with a Save button.
You never run the charts yourself and you never save the dashboard.

For a single one-off chart with no dashboard involved, call
`loadSkill('analytics')` instead.

## Which surface are you on?

Check your tools before doing anything else.

- **You have `proposeDashboard`** — the Product Analytics chat. Follow the leaf's
  workflow.
- **You don't** — the site-wide assistant panel. There is no preview here.
  _Building_: restate the request as a brief (metrics, timeframe, name if given),
  call `openAnalyticsChat`, and stop — don't settle the full brief or run
  queries first. _Editing_: apply the change directly via the dashboards API;
  see `<editing_without_a_preview>` in `dashboard-edit`.

## Workflows

| Workflow                         | Use when                         |
| -------------------------------- | -------------------------------- |
| `references/dashboard-create.md` | Building a new dashboard         |
| `references/dashboard-edit.md`   | Changing a dashboard that exists |

## Scope

You build **general** (Analytics) dashboards — no `experimentId`. They live at
`/product-analytics/dashboards/<id>` and support these block types only:

- **Product analytics:** `metric-exploration`, `fact-table-exploration`,
  `data-source-exploration`, `funnel-exploration`
- **Experimentation:** `experiments-status`, `experiments-win-rate`,
  `metric-experiments`, `experiments-scaled-impact`
- **Other:** `markdown`, `sql-explorer`

Anything else — in particular the per-experiment result blocks
(`experiment-metric`, `experiment-dimension`, `experiment-time-series`,
`experiment-metadata`, `experiment-traffic`) — belongs to an experiment's own
dashboard and cannot go here. If the user wants results for one specific
experiment, say those live on the experiment's page and offer
`loadSkill('experiments/references/experiment-analyze')` instead.

Do not use the `metric-explorer` block type. It is deprecated; use
`metric-exploration`.

## Archetypes

Pick the shape of the dashboard before picking blocks — one decision here
replaces half a dozen field-by-field questions.

| Archetype                     | Blocks, in order                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **KPI overview**              | one `bigNumber` metric-exploration per metric (`small`), then one `line` trend per metric (`medium`)                                     |
| **Funnel / conversion**       | `funnel-exploration` (`full`), then a `line` trend of the entry metric (`medium`), then a breakdown of it by one dimension (`medium`)    |
| **Single-metric deep dive**   | `bigNumber` (`small`), `line` trend (`medium`), one `bar` breakdown per dimension (`medium`), optional `fact-table-exploration` (`full`) |
| **Experiment program review** | `experiments-status` + `experiments-win-rate` (`medium` each), then `metric-experiments` + `experiments-scaled-impact` (`full` each)     |

Archetypes compose. "Signup funnel plus how our tests are doing" is the funnel
set followed by the experiment-program set, with a `markdown` heading between
them.

If the request clearly implies an archetype — "funnel health", "how are our
experiments doing", "dashboard for the revenue metric" — pick it silently and
say which one you picked. Only ask when two or more are genuinely plausible.

## Page context

When the user message starts with `[Page context: <path>]`:

- `/product-analytics/dashboards` → browsing; no specific dashboard.
- `/product-analytics/dashboards/<id>` → that dashboard
  (`GET /api/v1/dashboards/<id>`). "Add a chart to this" means this one — route
  to `dashboard-edit`.
- `/product-analytics/explore/...` → the user is mid-exploration; they likely
  want that chart saved onto a dashboard.

Prefer a named entity in the user's message over page context when they conflict.

A `[Active product-analytics datasource: <id>]` line is the datasource the user
currently has selected. Treat it as the answer to "which datasource" without
asking.

## Ask budget

**The name and the project have no default and must be settled before the create
call** — they are the only two things the preview cannot fix. Ask for both in one
`askUser`, then **at most one more** question, bundling any remaining gaps into
it.

| Slot             | Default                        | Ask only when                                              |
| ---------------- | ------------------------------ | ---------------------------------------------------------- |
| Name             | none                           | always, unless the user already named it                   |
| Project          | none                           | the org has 2+ projects and the user hasn't named one      |
| Datasource       | the hint, or the only one      | 2+ exist and none is named                                 |
| Archetype        | inferred from wording          | 2+ genuinely plausible                                     |
| Metrics          | search hits                    | 0 hits, or one named metric matches 2+ results             |
| Timeframe        | `{ predefined: "last30Days" }` | user is vague about a period ("recently", "this quarter")  |
| Granularity      | `"auto"`                       | never — `auto` is always acceptable                        |
| Breakdown        | none                           | user said "by X" and X maps to 2+ columns                  |
| Comparison       | off                            | user implies one ("vs last month") but the mode is unclear |
| Block projects   | `[]` (all)                     | user names a team or project matching 2+                   |
| Experiment scope | `""` (no filter)               | user scoped experiments vaguely ("our checkout tests")     |
| Share level      | `"private"`                    | never — they can publish it afterwards                     |

Never ask a question whose answer would not change a block — build something
reasonable and state your assumptions instead.

Projects: `GET /api/v1/projects`. Skip the question when the org has none or one
— pass `[]` or that single id. `[]` means visible in every project, which is
also the answer when the user says "all of them".

## Shared conventions

- **Mutations:** non-GET `callApi` calls are gated automatically. Issue the call
  when ready — do not use `askUser` for write confirmation. Pass a `summary` on
  every write; it is all the user sees before approving.
- **Never run the charts yourself.** `runExploration` renders its own chart card
  per call, so a six-tile dashboard would spray six loose charts into the chat
  before the dashboard appeared. Hand the configs to `proposeDashboard`; it runs
  them and wires up the results.
- **Never save the dashboard.** The user saves from the preview. Saving for them
  takes the choice away, and the preview is where they adjust the sharing,
  filters, and layout.
- **Links:** `/product-analytics/dashboards/<id>`.
- **Never guess a column value.** `POST /api/v1/product-analytics/column-values`
  first, for row filters and static dimension values alike.
