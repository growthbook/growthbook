---
name: dashboard-create
description: Build a new Analytics dashboard from a goal or a set of metrics — pick the blocks, run each chart, lay them out, and create it. Use when the user asks to "build me a dashboard", "make a dashboard for X", "put these metrics on a dashboard", "I want to track X and Y", or "set up reporting for X". For changing a dashboard that already exists, use dashboard-edit.
---

# dashboard-create

Build a general (Analytics) dashboard end to end: settle the brief, find the
metrics, run every chart so it has real data, lay the blocks out, and create the
dashboard in one write.

Use `callApi` for every REST request. The create call is gated automatically —
issue it directly; do not use `askUser` for write confirmation.

## Workflow

1. **Pick the datasource.** See `<datasource_selection>`.

2. **Settle the brief.** Pick an archetype (see the `dashboards` router) and fill
   the slots. Respect the ask budget: **at most two `askUser` calls**, bundling
   independent gaps into one multi-select question. Take the default for
   everything else and say what you assumed.

3. **Find the metrics.**

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

4. **Discover columns, only if you need a breakdown or a filter.**

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

5. **Run every exploration block's chart.** One POST per chart block, to the
   endpoint matching its `dataset.type`:

   | Block type                | Endpoint                                            |
   | ------------------------- | --------------------------------------------------- |
   | `metric-exploration`      | `/api/v1/product-analytics/metric-exploration`      |
   | `fact-table-exploration`  | `/api/v1/product-analytics/fact-table-exploration`  |
   | `data-source-exploration` | `/api/v1/product-analytics/data-source-exploration` |
   | `funnel-exploration`      | `/api/v1/product-analytics/funnel-exploration`      |

   The body **is** the block's `config`. Keep `exploration.id` from each
   response — that is the block's `explorerAnalysisId`.

   These POSTs are reads; they are not gated and do not need a `summary`.

   Unlike a one-off chart request, you run **several** explorations in this
   workflow — one per chart block. That is expected here.

6. **Lay the blocks out.** See `<layout>`.

7. **Create the dashboard**, once, with a `summary` naming the blocks:

   ```json
   {
     "method": "POST",
     "path": "/api/v1/dashboards",
     "summary": "Create dashboard 'Growth KPIs' with 5 blocks: revenue and signup KPIs, 30-day trends for each, signups by platform",
     "body": {
       "title": "Growth KPIs",
       "editLevel": "published",
       "shareLevel": "private",
       "enableAutoUpdates": false,
       "globalControls": {
         "dateRange": { "predefined": "last30Days" },
         "dateGranularity": "auto"
       },
       "blocks": [
         /* see <blocks> */
       ]
     }
   }
   ```

8. **Report back.** Name the dashboard, list what's on it in one line, state any
   assumption you made, and link `/product-analytics/dashboards/<id>`. If the
   user rejected the write, do not retry it — ask what to change instead.

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
3. Reuse that datasource for every block on the dashboard. A dashboard's blocks
   may span datasources, but don't mix them unless the user asks.
   </datasource_selection>

<dashboard_settings>

- `title` — short and specific: "Growth KPIs", "Signup Funnel", not "Dashboard".
- `editLevel` — `"published"` so teammates with permission can edit. Use
  `"private"` only if the user asks.
- `shareLevel` — `"private"`. The user can publish it themselves afterwards.
- `enableAutoUpdates` — `false`. Only set `true` when the user asks for scheduled
  refreshes, and then `updateSchedule` is required: either
  `{ "type": "stale", "hours": 24 }` or `{ "type": "cron", "cron": "0 8 * * *" }`.
- `projects` — omit unless the user scoped the dashboard to a project.
- `globalControls` — `{ dateRange, dateGranularity?, projects?, experimentSearchString? }`.
  Set `dateRange` and `dateGranularity` from the brief. Set `projects` /
  `experimentSearchString` only when the dashboard has experimentation blocks
  and the user scoped them; `projects: []` means all projects.

**Do not set `globalControlSettings` on any block.** Enrolling blocks into the
dashboard's filters happens automatically on create. Writing the flags yourself
risks opting blocks out of the filter bar the user just asked for.
</dashboard_settings>

<blocks>
Every block needs `type`, `title`, and `description`. Both strings are required —
use `""` for a description you have nothing to say about, but always give a chart
a real `title`; it is the block's heading.

Add `layout` per `<layout>`.

### Exploration blocks

`metric-exploration`, `fact-table-exploration`, `data-source-exploration`,
`funnel-exploration`:

```json
{
  "type": "metric-exploration",
  "title": "Revenue over time",
  "description": "",
  "explorerAnalysisId": "<exploration.id from step 5>",
  "config": {
    /* the exact config you POSTed */
  },
  "layout": { "x": 0, "y": 4, "w": 12, "h": 8 }
}
```

`config` must be the same object you ran in step 5 — if they diverge, the block
renders one thing and refreshes into another.

Add `"comparison": { "enabled": true, "mode": "previousPeriod" }` to a block only
when the user asked to compare periods. Modes: `previousPeriod`,
`previousPeriodMatchDayOfWeek`, `previousYear`, `previousYearMatchDayOfWeek`,
`custom` (with `previousTimeFrame`).

### Experimentation blocks

These carry no analysis id and need no exploration run — they compute from
experiment data. They are the cheapest blocks to get right.

```json
{
  "type": "experiments-status",
  "title": "Team Velocity",
  "description": "",
  "dateRange": { "predefined": "last90Days" },
  "projects": [],
  "dateGranularity": "auto"
}
```

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
- `bandits`: `false` unless the user asks about bandits.
- **`metric-experiments` has no `dateRange`.** It filters on phase dates instead,
  via optional `startDateRange` (phase start, so in-flight experiments can be
  included) and `endDateRange` (phase end). Setting `dateRange` on it is
  rejected. It also ignores the dashboard's date filter for the same reason —
  mention this if the user expects the date control to move it.
- `experiments-scaled-impact` and `metric-experiments` both need a `metricId`, so
  they still need step 3.
- Omit `columns` on `metric-experiments` for the default column order.

### markdown

```json
{
  "type": "markdown",
  "title": "",
  "description": "",
  "content": "## Funnel\nDaily conversion."
}
```

Use one as a section heading when a dashboard mixes archetypes. Keep it to a
heading and at most a sentence — the user did not ask for prose.

### sql-explorer

Only usable with a saved query that already exists (`savedQueryId`, plus
`blockConfig: []`). Skip this block type unless the user names a saved query.
</blocks>

<config_schema>
Top-level exploration config: `{ type, datasource, chartType, dateRange, dimensions, dataset, showAs? }`

- `type`: `"metric" | "fact_table" | "data_source" | "funnel"` — must match
  `dataset.type` and the endpoint you call.
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
- `showAs`: `"total" | "per_unit"`. Omit unless the user clearly asked for one
  ("per user" → `per_unit`, "total X" → `total`), and only when a mean metric is
  involved.

Always send a complete config.
</config_schema>

<chart_rules>

- Timeseries charts (`line`, `area`, `timeseries-table`) **must** include a date
  dimension. Cumulative charts (`bar`, `stackedBar`, `horizontalBar`,
  `stackedHorizontalBar`, `table`, `bigNumber`) must **not**.
- `bigNumber` takes exactly 1 value and 0 dimensions. On a dashboard it is the
  right choice for a KPI tile — unlike a one-off chart request, where you would
  avoid it.
- Default to `line` for trends and `bar` for breakdowns.
- Max 2 dimensions per chart, including the date dimension. If a dataset has
  more than one value, max 1 dimension.
- Do not add a breakdown dimension unless the user asked to split by something.
- Follow the `unitNote` from the columns endpoint: for metrics, set `unit` to
  `userIdTypes[0]` for mean/proportion/retention/dailyParticipation metrics and
  `null` for ratio/quantile; `denominatorUnit` is always `null`. For fact tables,
  `unit_count` takes a unit and `count`/`sum` take `null`.
- For funnels, prefer a funnel metric the org already defines over hand-building
  `steps`. Only build steps when the user names them and you can resolve each
  step's fact table.
  </chart_rules>

<layout>
The grid is 24 columns wide. Give each block a `layout` of `{ x, y, w, h }`:

| Intent                    | `w` | `h` |
| ------------------------- | --- | --- |
| KPI tile (`bigNumber`)    | 8   | 4   |
| Paired chart              | 12  | 8   |
| Full-width chart or table | 24  | 8   |
| Markdown heading          | 24  | 3   |

Pack left to right: place blocks along a row while the widths still fit inside
24, then start a new row. Every block in a row shares that row's `h` (the
tallest member), and `y` for the next row is the previous `y` plus that height.

Three KPI tiles then two paired trends:

```
{ "x": 0, "y": 0, "w": 8, "h": 4 }    { "x": 8, "y": 0, "w": 8, "h": 4 }    { "x": 16, "y": 0, "w": 8, "h": 4 }
{ "x": 0, "y": 4, "w": 12, "h": 8 }   { "x": 12, "y": 4, "w": 12, "h": 8 }
```

Do not go narrower than 8 — the grid snaps blocks back up to their minimum width
and your layout would shift the first time the user drags one. Experimentation
blocks and tables have a minimum of 12, so pair or full-width them, never a KPI
tile.

Omitting `layout` entirely is valid — blocks then stack full-width in order. Do
that only for a single-block dashboard.
</layout>

## Guardrails

- **An exploration block without a real `explorerAnalysisId` is a broken block.**
  It renders blank and stays blank: dashboard refresh skips blocks whose id is
  empty, and nothing else populates it. Never send `"explorerAnalysisId": ""`.
  If an exploration failed, fix it and rerun, or drop that block and say so.
- **`config` on the block must match the config you ran.** Copy it across
  verbatim.
- **One create call.** Build the whole `blocks` array, then POST once. Creating a
  dashboard and then adding blocks one at a time means a gated confirmation per
  block.
- **Never guess a column value.** `column-values` first, every time.
- **`metric-experiments` rejects `dateRange`.** Use `startDateRange` /
  `endDateRange`.
- **Do not set `globalControlSettings`.** Enrollment is automatic on create.
- **Do not use `metric-explorer`.** Deprecated; use `metric-exploration`.
- **No per-experiment blocks.** `experiment-metric`, `experiment-dimension`,
  `experiment-time-series`, `experiment-metadata`, and `experiment-traffic`
  belong to an experiment's own dashboard, not an Analytics one.
- **Stop at two questions.** Then build, and state your assumptions.
- **Rejected write means stop.** If the user cancels the create, ask what to
  change; do not reissue it.

## Endpoints used

- `GET /api/v1/data-sources` — list datasources
- `GET /api/v1/product-analytics/search` — find metrics and fact tables
- `GET /api/v1/product-analytics/columns` — columns, userIdTypes, unit guidance
- `POST /api/v1/product-analytics/column-values` — real values in a string column
- `POST /api/v1/product-analytics/{metric,fact-table,data-source,funnel}-exploration`
  — run a chart; returns the `exploration.id` a block needs
- `POST /api/v1/dashboards` — create the dashboard

## Handoffs

- `loadSkill('dashboard-edit')` — to change the dashboard afterwards
- `loadSkill('product-analytics')` — if the user only wanted one chart, not a
  dashboard
- `loadSkill('experiment-analyze')` — if they wanted results for one specific
  experiment
