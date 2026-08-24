---
name: dashboard-create
description: Build a new Analytics dashboard from a goal or a set of metrics — settle the brief, pick the blocks, and show the user a live preview to save. Use when the user asks to "build me a dashboard", "make a dashboard for X", "put these metrics on a dashboard", "I want to track X and Y", or "set up reporting for X". For changing a dashboard that already exists, use dashboard-edit.
---

# dashboard-create

Settle the brief, find the metrics, then hand the whole thing to
`proposeDashboard` in one call. It runs every query, lays out the grid, and shows
the user a live preview with a Save button.

You do not run the charts and you do not save the dashboard. Both are handled for
you.

## Which surface are you on?

Check your tools before doing anything else.

- **You have `proposeDashboard`** — the Product Analytics chat. Follow the
  workflow below.
- **You don't** — the site-wide assistant panel. You cannot build a dashboard
  here: there is no preview for the user to save from, and a dashboard nobody
  can see is not worth writing to the API. Instead, restate the request as a
  brief — the metrics, the timeframe, and the name if they gave one — call
  `openAnalyticsChat` with it, and stop. Don't settle the full brief first and
  don't run any queries; the chat on the other side asks for whatever it still
  needs.

## Workflow

1. **Pick the datasource.** See `<datasource_selection>`.

2. **Get a name and a project.** `proposeDashboard` requires a `title` and takes
   a `projects` array. These are the two things the user cannot fix from the
   preview — a saved dashboard has to be edited by hand to be renamed or moved —
   so settle them before you build.
   - **Name:** if the user hasn't given one, ask. Do not invent one and do not
     guess one from the metrics.
   - **Project:** `GET /api/v1/projects`. None or one → pass `[]` or that id
     without asking. Two or more and the user hasn't named one → ask. `[]` means
     every project.

   Ask for both in a **single** `askUser` (one multi-select question with both
   slots) rather than two round-trips, then stop and wait for the reply.

3. **Settle the rest of the brief.** Pick an archetype (`loadSkill('dashboards')`
   for the archetype table and the ask budget) and fill the slots. Everything
   else has a default: take it, and say what you assumed in your reply. Beyond
   the name and project, **at most one more `askUser`**. Sharing and auto-refresh
   are adjustable in the preview, so never ask about those.

4. **Find the metrics.**

   ```json
   {
     "method": "GET",
     "path": "/api/v1/product-analytics/search",
     "query": { "query": "revenue", "datasourceId": "<ds-id>" }
   }
   ```

   Keep terms short (1–3 words). Prefer `kind: "metric"` over `"fact_table"`, and
   `official: true` over not. If the user `@`-mentioned metrics, the
   `[Referenced by the user: …]` line is authoritative — use those ids directly
   and skip the search for them.

5. **Discover columns, only if you need a breakdown or a filter.**

   ```json
   {
     "method": "GET",
     "path": "/api/v1/product-analytics/columns",
     "query": { "source": "metric", "metricIds": "fact__a,fact__b" }
   }
   ```

   `metricIds` is comma-separated and returns the intersection of columns across
   those metrics' fact tables. For a fact table, pass
   `{ "source": "fact_table", "factTableId": "ftb_..." }`. Follow the `unitNote`
   it returns.

   Before pinning any specific value, confirm it exists:

   ```json
   {
     "method": "POST",
     "path": "/api/v1/product-analytics/column-values",
     "body": {
       "source": "metric",
       "metricIds": ["fact__a"],
       "columns": ["platform"],
       "searchTerm": "ios"
     }
   }
   ```

6. **Propose the dashboard**, once, with every block:

   ```json
   {
     "title": "Growth KPIs",
     "projects": ["prj_abc123"],
     "globalControls": {
       "dateRange": { "predefined": "last30Days" },
       "dateGranularity": "auto"
     },
     "blocks": [
       {
         "type": "metric-exploration",
         "title": "Revenue",
         "description": "",
         "sizeHint": "small",
         "config": { "...": "a bigNumber config" }
       },
       {
         "type": "metric-exploration",
         "title": "Revenue over time",
         "description": "",
         "sizeHint": "medium",
         "config": { "...": "a line config" }
       }
     ]
   }
   ```

7. **Stop.** One short sentence naming what is on the dashboard, plus any
   assumption you made and any block the tool reported as dropped. Do not
   describe the layout tile by tile — the user is looking at it.

<datasource_selection>
A datasource scopes which metrics and fact tables are visible. Pick one before
searching.

If the latest user message carries an `[Active product-analytics datasource: <id>]`
line, use that id — it is the user's current selection. Otherwise:

1. `GET /api/v1/data-sources`
2. Decide:
   - 0 → tell the user no datasource is configured and stop.
   - 1 → use it, and mention which one. Do not ask.
   - 2+ and the user named one → use that one.
   - 2+ and ambiguous → `askUser` with one option per datasource (`id` =
     datasource id, `label` = its name), then end the turn.
3. Reuse that datasource for every block on the dashboard.
   </datasource_selection>

<blocks>
Every block needs `type`, `title`, and `description` (`""` is fine for the
description, but always give a chart a real title — it is the tile's heading).
`sizeHint` is optional and defaults to `full`.

Do **not** send `explorerAnalysisId`, `layout`, `snapshotId`, or
`globalControlSettings`. The analysis ids come from running the queries, the
layout comes from the packer, and blocks are enrolled in the dashboard filter bar
automatically. Sending them is rejected.

### Chart blocks

`metric-exploration`, `fact-table-exploration`, `data-source-exploration`,
`funnel-exploration` — each carries a `config` matching `<config_schema>`:

```json
{
  "type": "metric-exploration",
  "title": "Revenue over time",
  "description": "",
  "sizeHint": "medium",
  "config": { "type": "metric", "datasource": "ds_abc", "...": "..." }
}
```

Add `"comparison": { "enabled": true, "mode": "previousPeriod" }` only when the
user asked to compare periods. Modes: `previousPeriod`,
`previousPeriodMatchDayOfWeek`, `previousYear`, `previousYearMatchDayOfWeek`,
`custom` (with `previousTimeFrame`).

### Experimentation blocks

These need no query run — they compute client-side from experiment data.

| Type                        | Suggested title       | Fields beyond title/description                                               |
| --------------------------- | --------------------- | ----------------------------------------------------------------------------- |
| `experiments-status`        | Team Velocity         | `dateRange`, `projects`, `dateGranularity?`                                   |
| `experiments-win-rate`      | Win Percentage        | `dateRange`, `projects`, `showProjectBreakdown` (`true`)                      |
| `experiments-scaled-impact` | Scaled Impact         | `dateRange`, `projects`, `metricId`                                           |
| `metric-experiments`        | Experiments with Lift | `metricId`, `projects`, `experimentSearchString`, `differenceType`, `bandits` |

- `projects: []` means all projects.
- `experimentSearchString` is a raw search query applied on top of the date and
  project scope, e.g. `"status:stopped tag:checkout"`. Use `""` unless the user
  scoped the experiments.
- `differenceType`: `"relative"` (default), `"absolute"`, or `"scaled"`.
- **`metric-experiments` has no `dateRange`.** It filters on phase dates via
  optional `startDateRange` (phase start, so in-flight experiments can be
  included) and `endDateRange` (phase end). It also ignores the dashboard's date
  filter for the same reason — mention that if the user expects otherwise.
- `experiments-scaled-impact` and `metric-experiments` both need a `metricId`, so
  they still need step 4.

### markdown

```json
{
  "type": "markdown",
  "title": "",
  "description": "",
  "sizeHint": "full",
  "content": "## Funnel"
}
```

Use one as a section heading when a dashboard mixes archetypes. A heading and at
most a sentence — the user did not ask for prose.

`sql-explorer` is not available through `proposeDashboard`; it needs an existing
saved query and is better added by hand.
</blocks>

<config_schema>
Chart config: `{ type, datasource, chartType, dateRange, dimensions, dataset, showAs? }`

- `type`: `"metric" | "fact_table" | "data_source" | "funnel"` — must match
  `dataset.type` and the block type.
- `chartType`: `"line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber"`
- `dateRange`: `{ predefined, lookbackValue?, lookbackUnit?, startDate?, endDate? }`.
  Valid `predefined`: `"today"`, `"yesterday"`, `"last7Days"`, `"last30Days"`,
  `"last90Days"`, `"last12Months"`, `"lastCalendarYear"`, `"customLookback"`,
  `"customDateRange"`. `"last14Days"` is **not** valid — use
  `{ predefined: "customLookback", lookbackValue: 14, lookbackUnit: "day" }`.
- `dimensions`:
  - date: `{ dimensionType: "date", column: null, dateGranularity: "auto" }`
  - dynamic (top N): `{ dimensionType: "dynamic", column: "platform", maxValues: 5 }`
  - static (named values): `{ dimensionType: "static", column: "platform", values: ["ios","android"] }`
    — only after confirming the values via `column-values`.
- `dataset` by type:
  - `metric`: `{ type: "metric", values: [{ type: "metric", name, metricId, unit, denominatorUnit: null, rowFilters: [] }] }`
  - `fact_table`: `{ type: "fact_table", factTableId, values: [{ type: "fact_table", name, valueType: "unit_count"|"count"|"sum", valueColumn, unit, rowFilters: [] }] }`
  - `funnel`: `{ type: "funnel", unit, steps: [{ name, factTableId, rowFilters: [], optional: false }], yAxisScale?: "count"|"percent" }`
- `rowFilters`: `[{ operator, column, values }]` with operator one of `"="`,
  `"!="`, `"in"`, `"not_in"`, `"contains"`, `"not_contains"`, `"starts_with"`,
  `"ends_with"`, `"is_null"`, `"not_null"`.
- `showAs`: `"total" | "per_unit"`. Omit unless the user clearly asked for one,
  and only when a mean metric is involved.
  </config_schema>

<chart_rules>

- Timeseries charts (`line`, `area`, `timeseries-table`) **must** include a date
  dimension. Cumulative charts (`bar`, `stackedBar`, `horizontalBar`,
  `stackedHorizontalBar`, `table`, `bigNumber`) must **not**.
- `bigNumber` takes exactly 1 value and 0 dimensions. On a dashboard it is the
  right choice for a KPI tile — unlike a one-off chart request, where you would
  avoid it.
- Default to `line` for trends and `bar` for breakdowns.
- Max 2 dimensions per chart, including the date dimension. If a dataset has more
  than one value, max 1 dimension.
- Do not add a breakdown dimension unless the user asked to split by something.
- Follow the `unitNote` from the columns endpoint: for metrics, set `unit` to
  `userIdTypes[0]` for mean/proportion/retention/dailyParticipation metrics and
  `null` for ratio/quantile; `denominatorUnit` is always `null`. For fact tables,
  `unit_count` takes a unit and `count`/`sum` take `null`.
- The one-chart-per-turn rule does **not** apply here. A dashboard has one chart
  per tile and `proposeDashboard` runs them all in one call.
  </chart_rules>

<layout>
Set `sizeHint` per block and let the packer place them on the 24-column grid:

| Intent                    | `sizeHint` | Result             |
| ------------------------- | ---------- | ------------------ |
| KPI tile (`bigNumber`)    | `small`    | three across       |
| Paired chart              | `medium`   | two across         |
| Full-width chart or table | `full`     | one per row        |
| Markdown heading          | `full`     | one per row, short |

Order the blocks the way they should read top to bottom: KPI tiles first, then
their trends, then breakdowns and tables. The user can rearrange the grid in the
preview, so aim for a sensible default rather than a perfect one.
</layout>

## Guardrails

- **Never call `runExploration` for a dashboard.** Every call renders its own
  chart card in the chat, so the user sees a pile of loose charts before the
  dashboard appears. Pass configs to `proposeDashboard`.
- **Never save the dashboard.** No `POST /api/v1/dashboards`. The user saves from
  the preview; saving for them takes the choice away.
- **Never invent the title, and never guess the project.** Ask for both, in one
  question. They are the only two things the preview cannot fix.
- **One `proposeDashboard` call per turn**, with the complete block list. To
  revise, call it again with the full revised list — it replaces the proposal.
- **Never guess a column value.** `column-values` first, every time.
- **No per-experiment blocks.** `experiment-metric`, `experiment-dimension`,
  `experiment-time-series`, `experiment-metadata`, and `experiment-traffic`
  belong to an experiment's own dashboard, not an Analytics one.
- **Stop at one question** beyond the name-and-project one. Then build, and
  state your assumptions.
- If the tool reports `droppedBlocks`, say which tiles are missing and why — do
  not present a partial dashboard as complete.

## Endpoints used

- `GET /api/v1/data-sources` — list datasources
- `GET /api/v1/projects` — list projects, to settle which one the dashboard is in
- `GET /api/v1/product-analytics/search` — find metrics and fact tables
- `GET /api/v1/product-analytics/columns` — columns, userIdTypes, unit guidance
- `POST /api/v1/product-analytics/column-values` — real values in a string column

Everything else goes through the `proposeDashboard` tool.

## Handoffs

- `loadSkill('dashboard-edit')` — to change a dashboard that is already saved
- `loadSkill('product-analytics')` — if the user only wanted one chart
