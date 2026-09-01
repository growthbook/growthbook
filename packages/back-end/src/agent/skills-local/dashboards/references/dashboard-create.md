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

4. **Find the metrics** with the `search` tool — the same one you use for a
   one-off chart, so nothing here is dashboard-specific.

   Keep terms short (1–3 words). Prefer `kind: "metric"` over `"fact_table"`, and
   `official: true` over not. If the user `@`-mentioned metrics, the
   `[Referenced by the user: …]` line is authoritative — use those ids directly
   and skip the search for them.

5. **Discover columns, only if you need a breakdown or a filter.**
   `getAvailableColumns` with `{ source: "metric", metricIds: ["fact__a", "fact__b"] }`
   returns the intersection of columns across those metrics' fact tables; for a
   fact table, pass `{ source: "fact_table", factTableId: "ftb_..." }`. Follow the
   `unitNote` it returns.

   Before pinning any specific value, confirm it exists with `getColumnValues`
   — `{ source: "metric", metricIds: ["fact__a"], columns: ["platform"], searchTerm: "ios" }`.

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
`funnel-exploration` — each carries a `config`.

<config_schema>
The same exploration config you would pass to `runExploration`, and the schema
summary in your system prompt is authoritative for it. Two additions:

- `funnel` dataset: `{ type: "funnel", unit, steps: [{ name, factTableId, rowFilters: [], optional: false }], yAxisScale?: "count"|"percent" }`
- `"last14Days"` is **not** a valid `predefined` — use
  `{ predefined: "customLookback", lookbackValue: 14, lookbackUnit: "day" }`.
  </config_schema>

<chart_rules>

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

The `dashboards` skill carries the shared rules. On top of those:

- **One `proposeDashboard` call per turn**, with the complete block list. To
  revise, call it again with the full revised list — it replaces the proposal.
  Still no `dashboardId`: nothing exists until the user saves, and sending one
  binds the preview to a dashboard that isn't there.
- **Stop at one question** beyond the name-and-project one. Then build, and
  state your assumptions.
- If the tool reports `droppedBlocks`, say which tiles are missing and why — do
  not present a partial dashboard as complete.

## Endpoints and tools used

`callApi`, for the two things your tools cannot tell you:

- `GET /api/v1/data-sources` — list datasources
- `GET /api/v1/projects` — list projects, to settle which one the dashboard is in

Your own tools for everything else: `search` for metrics and fact tables,
`getAvailableColumns` for columns and unit guidance, `getColumnValues` for the
real values in a string column, and `proposeDashboard` to build the thing.

## Handoffs

- `loadSkill('dashboards/references/dashboard-edit')` — to change a dashboard that is already saved
- `loadSkill('analytics')` — if the user only wanted one chart
