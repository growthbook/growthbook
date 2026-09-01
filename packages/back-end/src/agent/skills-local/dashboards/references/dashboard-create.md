---
name: dashboard-create
description: Build a new Analytics dashboard from a goal or a set of metrics — settle the brief, pick the blocks, and show the user a live preview to save. Use when the user asks to "build me a dashboard", "make a dashboard for X", "put these metrics on a dashboard", "I want to track X and Y", or "set up reporting for X". For changing a dashboard that already exists, use dashboard-edit.
---

# dashboard-create

**Scope: a dashboard with no `dashboardId` yet** — nothing proposed yet, or a
preview the user has not saved. Both live here.

Revising an unsaved preview stays here however many rounds it takes: skip to
step 6 (name, project, datasource and metrics are already settled) and follow
the router's **revision round** rules. The one that bites on this side: with no
id there is nothing saved to fall back to, so `title`, `projects`,
`globalControls` and `comparison` all revert if you leave them out — copy all
four, plus every block being kept, from your newest `proposeDashboard` call.

The moment it has an id — the user saved it, loaded one, or `@`-mentioned one —
`dashboard-edit` governs and its rules win over everything below. This file
stays in your context after you have used it, so check which you are in before
following it.

Settle the brief, find the metrics, then hand the whole thing to
`proposeDashboard` in one call. It runs every query, lays out the grid, and shows
the user a live preview with a Save button.

Running the charts and saving the dashboard are both handled for you.

## Workflow

1. **Pick the datasource.** See `<datasource_selection>`.

2. **Get a name and a project.** `proposeDashboard` requires a `title` and takes
   a `projects` array. These are the two things the user cannot fix from the
   preview — a saved dashboard has to be edited by hand to be renamed or moved —
   so settle them before you build.
   - **Name:** use the user's own words for it, and ask when they have given
     none.
   - **Project:** `GET /api/v1/projects`. None or one → pass `[]` or that id
     without asking. Two or more and the user hasn't named one → ask. `[]` means
     every project.

   Ask for both in a **single** `askUser` (one multi-select question with both
   slots) rather than two round-trips, then stop and wait for the reply.

3. **Settle the rest of the brief.** Pick an archetype (`loadSkill('dashboards')`
   for the archetype table and the ask budget) and fill the slots. Everything
   else has a default: take it, and say what you assumed in your reply. Beyond
   the name and project, **at most one more `askUser`**. Leave sharing and
   auto-refresh alone: sharing is a dropdown on the preview, and auto-refresh is
   off until they turn it on from the saved dashboard.

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
   assumption you made and any block the tool reported as dropped. The user is
   looking at the layout, so that sentence is all they need.

<datasource_selection>
A datasource scopes which metrics and fact tables are visible. Pick one before
searching.

If the latest user message carries an `[Active product-analytics datasource: <id>]`
line, use that id — it is the user's current selection. Otherwise:

1. `GET /api/v1/data-sources`
2. Decide:
   - 0 → tell the user no datasource is configured and stop.
   - 1 → use it and mention which one, no question needed.
   - 2+ and the user named one → use that one.
   - 2+ and ambiguous → `askUser` with one option per datasource (`id` =
     datasource id, `label` = its name), then end the turn.
3. Reuse that datasource for every block on the dashboard.
   </datasource_selection>

<blocks>
Every block needs `type`, `title`, and `description` (`""` is fine for the
description, but always give a chart a real title — it is the tile's heading).
`sizeHint` is optional and defaults to `full`.

### The legend

Exactly one `markdown` block, first in the list. It explains the whole dashboard
in one place, so no other block needs prose and no second `markdown` is ever
warranted:

```json
{
  "type": "markdown",
  "title": "About this dashboard",
  "description": "",
  "sizeHint": "full",
  "content": "How revenue efficiency and retention are tracking over the last 30 days.\n\n- **Revenue per User** — total revenue divided by active users.\n- **D7 Purchase Retention** — share of users who buy again within 7 days.\n- **Signups over time** — daily new accounts; watch for step changes."
}
```

The whole legend is one opening line on what the dashboard is for, then one
bullet per chart naming it and saying what to read from it — one line each, and
the filter bar already shows the timeframe.

Send exactly these fields on a block: `type`, `title`, `description`, `sizeHint`,
and (for chart blocks) `config`. The server supplies the rest —
`explorerAnalysisId` from running the queries, `layout` from the packer,
`snapshotId`, and `globalControlSettings` from enrolling the block in the filter
bar — and rejects a block that carries them.

### Chart blocks

`metric-exploration`, `fact-table-exploration`, `data-source-exploration`,
`funnel-exploration` — each carries a `config`.

<config_schema>
The same exploration config you would pass to `runExploration`, and the schema
summary in your system prompt is authoritative for it. Two additions:

- `funnel` dataset: `{ type: "funnel", unit, steps: [{ name, factTableId, rowFilters: [], optional: false }], yAxisScale?: "count"|"percent" }`
- `predefined` accepts exactly `today`, `yesterday`, `last7Days`, `last30Days`,
  `last90Days`, `last12Months`, `lastCalendarYear`, `customLookback`, and
  `customDateRange`. Any other window goes through `customLookback`, e.g. 14 days
  is `{ predefined: "customLookback", lookbackValue: 14, lookbackUnit: "day" }`.
  `lookbackUnit` is `hour`, `day`, `week`, or `month`.
  </config_schema>

<chart_rules>

- `bigNumber` takes exactly 1 value and 0 dimensions, and is the right choice for
  a KPI tile on a dashboard.
- Default to `line` for trends and `bar` for breakdowns.
- Max 2 dimensions per chart, including the date dimension. If a dataset has more
  than one value, max 1 dimension.
- Add a breakdown dimension when the user asks to split by something.
- Follow the `unitNote` from the columns endpoint: for metrics, set `unit` to
  `userIdTypes[0]` for mean/proportion/retention/dailyParticipation metrics and
  `null` for ratio/quantile; `denominatorUnit` is always `null`. For fact tables,
  `unit_count` takes a unit and `count`/`sum` take `null`.
- A dashboard has one chart per tile, and `proposeDashboard` runs every one of
  them in a single call. The one-chart-per-turn rule is for one-off charts.
  </chart_rules>

<layout>
Set `sizeHint` per block and let the packer place them on the 24-column grid:

| Intent                    | `sizeHint` | Result             |
| ------------------------- | ---------- | ------------------ |
| KPI tile (`bigNumber`)    | `small`    | three across       |
| Paired chart              | `medium`   | two across         |
| Full-width chart or table | `full`     | one per row        |
| The legend `markdown`     | `full`     | one per row, first |

Order the blocks the way they should read top to bottom: the legend first, then
KPI tiles, then their trends, then breakdowns and tables. The user can rearrange the grid in the
preview, so aim for a sensible default rather than a perfect one.
</layout>

## Guardrails

The `dashboards` skill carries the shared rules. On top of those:

- **One `proposeDashboard` call per turn**, with the complete block list — see
  the router's **revision round**.
- **Omit `dashboardId` here.** Nothing exists until the user saves, so an id
  would bind the preview to a dashboard that is not there. `dashboard-edit`
  is where ids belong.
- **Stop at one question** beyond the name-and-project one, and ask none at all
  on a revision round. Then build, and state your assumptions.
- When the tool reports `droppedBlocks`, name the missing tiles and say why, so
  what the user sees is described as the partial dashboard it is.

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
