---
name: dashboards
description: Build, extend, and edit Analytics dashboards — multi-block pages of charts and experiment summaries. Use when the user asks to "build me a dashboard", "make a dashboard for X", "put these metrics on a dashboard", "track X and Y over time", "add a chart to this dashboard", or for page context under /product-analytics/dashboards/*. For a single one-off chart with no dashboard involved, use product-analytics instead.
---

# Dashboards

Domain router for Analytics dashboards. Use `callApi` for all REST calls.
Dashboard endpoints are `/api/v1/dashboards`; the product analytics lookups a
dashboard is built from are `/api/v1/product-analytics/*`.

**Workflow:** read this router → `loadSkill('<leaf>')` for the matching
sub-skill below → follow that leaf's workflow.

Both leaves end the same way: one `proposeDashboard` call, which runs every
chart, lays out the grid, and shows the user a live preview with a Save button.
You never run the charts yourself and you never save the dashboard.

## Sub-skills

| Skill              | Use when                                                     |
| ------------------ | ------------------------------------------------------------ |
| `dashboard-create` | Building a new dashboard from a goal or a set of metrics     |
| `dashboard-edit`   | Adding, removing, or reconfiguring blocks on an existing one |

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
`loadSkill('experiment-analyze')` instead.

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

**At most two `askUser` calls before the create call.** Bundle independent gaps
into one multi-select question rather than asking them one at a time.

Every slot has a default. Ask only where the default would be wrong:

| Slot             | Default                        | Ask only when                                              |
| ---------------- | ------------------------------ | ---------------------------------------------------------- |
| Datasource       | the hint, or the only one      | 2+ exist and none is named                                 |
| Archetype        | inferred from wording          | 2+ genuinely plausible                                     |
| Metrics          | search hits                    | 0 hits, or one named metric matches 2+ results             |
| Timeframe        | `{ predefined: "last30Days" }` | user is vague about a period ("recently", "this quarter")  |
| Granularity      | `"auto"`                       | never — `auto` is always acceptable                        |
| Breakdown        | none                           | user said "by X" and X maps to 2+ columns                  |
| Comparison       | off                            | user implies one ("vs last month") but the mode is unclear |
| Projects         | `[]` (all)                     | user names a team or project matching 2+                   |
| Experiment scope | `""` (no filter)               | user scoped experiments vaguely ("our checkout tests")     |
| Share level      | `"private"`                    | never — they can publish it afterwards                     |

Never ask a question whose answer would not change a block. Prefer building
something reasonable and stating your assumptions over asking a third question:
the dashboard is editable, and the create call is gated behind a confirmation
the user can reject.

## Shared conventions

- **Mutations:** non-GET `callApi` calls are gated automatically. Issue the call
  when ready — do not use `askUser` for write confirmation. Pass a `summary` on
  every write; it is all the user sees before approving.
- **Never run the charts yourself.** `runExploration` renders its own chart card
  per call, so a six-tile dashboard would spray six loose charts into the chat
  before the dashboard appeared. Hand the configs to `proposeDashboard`; it runs
  them and wires up the results.
- **Never save the dashboard.** The user saves from the preview. Saving for them
  takes the choice away, and the preview is where they adjust the name, sharing,
  filters, and layout.
- **A name is required.** `proposeDashboard` needs a `title`; ask for it if the
  user hasn't given one. Everything else has a default and is adjustable in the
  preview, so don't ask about sharing, Project, or auto-refresh.
- **Links:** `/product-analytics/dashboards/<id>`.
- **Never guess a column value.** `POST /api/v1/product-analytics/column-values`
  first, for row filters and static dimension values alike.
