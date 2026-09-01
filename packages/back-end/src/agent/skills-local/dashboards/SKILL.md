---
name: dashboards
description: Build and edit Analytics dashboards. Use when the user asks to build, create, or change a dashboard, save charts together on a page, or page context under /product-analytics/dashboards/*.
---

# Dashboards

Domain router for Analytics dashboards. Reading a dashboard goes through
`callApi` at `/api/v1/dashboards`; everything a dashboard is built from — metrics,
columns, column values — comes from your own tools, not from REST.

**Workflow:** read this router → `loadSkill('dashboards/references/<leaf>')` for the matching
sub-skill below → follow that leaf's workflow.

Both leaves end the same way: one `proposeDashboard` call, which runs every
chart, lays out the grid, and shows the user a live preview. Creating or changing
a dashboard is something the **user** commits from that preview — you never run
the charts yourself, and you never write a dashboard through the API.

For a single one-off chart with no dashboard involved, call
`loadSkill('analytics')` instead.

## Which surface are you on?

Check your tools before doing anything else.

- **You have `proposeDashboard`** — the Product Analytics chat. Follow the leaf's
  workflow.
- **You don't** — the site-wide assistant panel, which cannot render a preview.
  Building and changing both hand off: restate the request as a brief (metrics,
  timeframe, the dashboard being changed if there is one), call
  `openAnalyticsChat`, and stop. Do not settle the full brief, run queries, or
  load a leaf first — the chat on the other side does all of that.

## Workflows

Route on one question: **does the dashboard have a `dashboardId`?**

| Workflow                         | Use when                                                   |
| -------------------------------- | ---------------------------------------------------------- |
| `references/dashboard-create.md` | No id yet — building one, or revising an unsaved preview   |
| `references/dashboard-edit.md`   | It has an id — the user saved, loaded, or `@`-mentioned it |

## The revision round

Both workflows end in a preview and then go round: "drop that tile", "make it 90
days", "add revenue", as many times as it takes before the user presses the
button. Every round is the same move on either side.

- **One `proposeDashboard` call, carrying the complete block list.** A proposal
  replaces the previous one whole, so what you send is the dashboard the user
  gets — every block being kept, not just the one that changed.
- **No questions.** Name, project, datasource and timeframe were settled on the
  first proposal, and someone asking to change one tile is not asking to revisit
  any of them.
- **The newest draft is the current state.** Take the blocks, and the
  `globalControls` and `comparison` the user has set, from your most recent
  `proposeDashboard` call — not from the first one.
- **Only the newest preview is live.** Proposing again expires the one before
  it: that tile goes read-only and its button stops working. So a round that
  leaves a block out has removed it as far as the user can act on it.

The `dashboardId` is the only thing that differs:

|                                                              | Unsaved preview (create) | Saved dashboard (edit) |
| ------------------------------------------------------------ | ------------------------ | ---------------------- |
| `dashboardId`                                                | omit — there is no id    | pass it, every round   |
| The preview's button                                         | **Save dashboard**       | **Update dashboard**   |
| Omitting `title`, `projects`, `globalControls`, `comparison` | **reverts** them         | keeps the saved value  |

**Once the user presses Save the dashboard has an id, and every round after that
is an edit.** You are told when that happens: the `proposeDashboard` result they
saved comes back carrying
`[The user saved this preview as dashboard <id> …]`. Take the id from there,
switch to `dashboard-edit`, and never ask which dashboard they mean or what it
is called.

## Scope

You build **general** (Analytics) dashboards — no `experimentId`. They live at
`/product-analytics/dashboards/<id>` and support these block types only:

- **Product analytics:** `metric-exploration`, `fact-table-exploration`,
  `data-source-exploration`, `funnel-exploration`
- **Experimentation:** `experiments-status`, `experiments-win-rate`,
  `metric-experiments`, `experiments-scaled-impact`
- **Other:** `markdown` (exactly one, the legend — see below), `sql-explorer`

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
set followed by the experiment-program set — still one legend, covering both.

If the request clearly implies an archetype — "funnel health", "how are our
experiments doing", "dashboard for the revenue metric" — pick it silently and
say which one you picked. Only ask when two or more are genuinely plausible.

## Page context

`[Page context: <path>]` only ever reaches the site-wide panel — the Product
Analytics chat does not send one. So it is a handoff-time signal, not something
to route on:

- `/product-analytics/dashboards/<id>` → the user means that dashboard. A path
  is not a mention and does not survive the handoff on its own, so read the
  title (`GET /api/v1/dashboards/<id>`) and pass both across as a
  `(dashboard: <id>)` entry in `openAnalyticsChat`'s `mentions`, with
  `mode: "edit"`.
- `/product-analytics/dashboards` → browsing; no specific dashboard.
- `/product-analytics/explore/...` → mid-exploration; they likely want that
  chart saved onto a dashboard.

Prefer a named entity in the user's message over page context when they conflict.

`[Active product-analytics datasource: <id>]` runs the other way — only the
Product Analytics chat receives it. Treat it as the answer to "which datasource"
without asking.

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

**This budget covers the first proposal only. Every round after it is zero** —
saved or not; see **The revision round** above. Make the change and show them the
preview, which is where they say no. Questions worth skipping there: which
dashboard they mean, whether to update it or create a new one, and whether they
meant the change they just described.

Projects: `GET /api/v1/projects`. Skip the question when the org has none or one
— pass `[]` or that single id. `[]` means visible in every project, which is
also the answer when the user says "all of them".

## Shared conventions

- **Reads only through `callApi`.** The dashboards API is there to read what
  already exists. Never POST, PUT, or DELETE a dashboard — the preview's button
  is the only thing that writes one, and the user presses it.
- **Add exactly one `markdown` block**, first in the list, and its only job is to
  be the legend: one line on what the dashboard is for, then one line per chart
  saying what to read from it. Never add a second — no section headings, no
  dividers, no per-group captions. A chart's own `title` is how it labels itself.
  This is a new-dashboard rule only. On a saved dashboard every `markdown` block
  belongs to the user: leave them exactly as they are, and never add one — its
  absence is a choice they already made.
- **Never run the charts yourself.** `runExploration` renders its own chart card
  per call, so a six-tile dashboard would spray six loose charts into the chat
  before the dashboard appeared. Hand the configs to `proposeDashboard`; it runs
  them and wires up the results.
- **Never save the dashboard.** The user commits from the preview, which is also
  where they adjust the sharing, filters, and layout.
- **Links:** `/product-analytics/dashboards/<id>`.
- **Never guess a column value.** Call `getColumnValues` first, for row filters
  and static dimension values alike.
