---
name: product-analytics
description: Build, run, and modify product analytics charts (metrics, fact tables, explorations). Use when the user asks about metrics, conversion, retention, funnels, charts, or anything starting with "show me…".
---

# Product analytics

You can build product analytics charts by calling the GrowthBook REST API
through the `callApi` tool. All paths in this skill are relative to the
GrowthBook server (e.g. `/api/v1/product-analytics/metric-exploration`).

<workflow>
Standard workflow for building a chart:
0. (First chart of a conversation) Pick a datasource — see `<datasource_selection>` below. Reuse the same datasource for follow-up requests in the same conversation unless the user changes it.
1. `GET /api/v1/product-analytics/search?query=<term>&datasourceId=<id>` — find the metric or fact table by name (or browse with an empty query). Always pass `datasourceId` so results are scoped.
2. `GET /api/v1/product-analytics/columns?source=<metric|fact_table>&...` — discover valid columns, userIdTypes, and unit requirements.
3. `POST /api/v1/product-analytics/column-values` — (only when filters or specific values are needed) look up actual column values. NEVER guess.
4. `POST /api/v1/product-analytics/metric-exploration` (or `/fact-table-exploration` / `/data-source-exploration`) — execute with a complete config. The chart is displayed automatically.

For follow-up modifications ("break down by country", "change to last 90 days", etc.), start from the config returned by the previous exploration response and apply the requested changes — do not rebuild from scratch.
</workflow>

<datasource_selection>
A datasource scopes which metrics and fact tables are visible. Pick one before searching.

If the latest user message carries an `[Active product-analytics datasource: <id>]` hint (auto-injected by the UI from the datasource the user currently has selected), use that `<id>` as the datasource for step 0 without calling `GET /api/v1/data-sources` or asking — it's the user's current selection. It's still only a hint: switch if the user names a different datasource, and follow the user if they ask to change. When there is no hint, fall back to the steps below.

1. Call `GET /api/v1/data-sources` to list datasources visible to the user.
2. Decide:
   - 0 datasources → tell the user no datasource is configured and stop.
   - 1 datasource → use it; do NOT ask. Mention which one you're using in your response.
   - 2+ datasources, and the user named one in their message (or asked for "metric X from Y") → use that one.
   - 2+ datasources, ambiguous → call the `askUser` tool with one option per datasource (id = datasource id, label = datasource name, description = type/projects if helpful), then end your turn. Once the user picks, proceed with the workflow using the chosen `datasourceId`.
3. Once a datasource is chosen for this conversation, reuse it for subsequent charts in the same chat unless the user explicitly switches.

Example `askUser` call when datasources are ambiguous:

```json
{
  "question": "Which datasource should I use?",
  "options": [
    {
      "id": "ds_snowflake_prod",
      "label": "Snowflake — Production",
      "description": "Postgres connector, prod schemas"
    },
    {
      "id": "ds_bq_warehouse",
      "label": "BigQuery — Warehouse",
      "description": "Analytics warehouse"
    }
  ]
}
```

</datasource_selection>

<endpoints>

## search — find metrics and fact tables

`GET /api/v1/product-analytics/search`

Query params:

- `query` (string, optional) — substring/keyword search. Empty string browses everything.
- `limit` (1–20, default 10) — page size.
- `skip` (default 0) — pagination offset.
- `datasourceId` (optional) — restrict to one datasource.

Each match has `kind` ("metric" or "fact_table") and `explorerType` indicating which exploration type to use. Results include an `official` field — prefer official=true resources. Use `id` as `metricId` or `factTableId` downstream.

Example call:

```json
{
  "method": "GET",
  "path": "/api/v1/product-analytics/search",
  "query": { "query": "retention", "limit": "10" }
}
```

## columns — discover columns + unit requirements

`GET /api/v1/product-analytics/columns`

Query params:

- `source` ("fact_table" or "metric") — which exploration type.
- `factTableId` — required when source=fact_table.
- `metricIds` — comma-separated list, required when source=metric. Returns the intersection of columns across the metrics' underlying fact tables.

Returns `columns`, `userIdTypes`, optional `metrics` array (per-metric `needsUnit` flag), and `unitNote` telling you exactly how to set the unit field.

Example call:

```json
{
  "method": "GET",
  "path": "/api/v1/product-analytics/columns",
  "query": { "source": "metric", "metricIds": "fact__abc,fact__def" }
}
```

## column-values — fetch actual values for a string column

`POST /api/v1/product-analytics/column-values`

Body:

- `source` ("fact_table" or "metric")
- `factTableId` or `metricIds`
- `columns` (array, 1–5 string column names)
- `searchTerm` (optional) — substring filter when you have a partial guess
- `limit` (1–50, default 20)

You MUST call this before using any specific column value — for row filters, dimension values, or any other purpose. Never guess column values. Only string columns are queryable.

Example call:

```json
{
  "method": "POST",
  "path": "/api/v1/product-analytics/column-values",
  "body": {
    "source": "fact_table",
    "factTableId": "ftb_orders",
    "columns": ["country"],
    "searchTerm": "US"
  }
}
```

## metric-exploration / fact-table-exploration / data-source-exploration — run a chart

- `POST /api/v1/product-analytics/metric-exploration` for `dataset.type: "metric"` configs.
- `POST /api/v1/product-analytics/fact-table-exploration` for `dataset.type: "fact_table"` configs.
- `POST /api/v1/product-analytics/data-source-exploration` for `dataset.type: "data_source"` configs.

The body IS the exploration config — see `<config_schema>` below. Add an optional query param `cache=preferred|required|never` (default `preferred`).

The response returns:

- `exploration` — the run, including `config` (the normalized config used) and `result.rows` (raw result rows).
- `query` — the underlying SQL query record.
- `explorationUrl` — a deep link to view the chart in the GrowthBook app.

The chart is displayed automatically to the user when this endpoint returns successfully — do not embed the config JSON in your text response.

Example call (metric exploration, line chart over last 30 days):

```json
{
  "method": "POST",
  "path": "/api/v1/product-analytics/metric-exploration",
  "body": {
    "type": "metric",
    "datasource": "ds_abc",
    "chartType": "line",
    "dateRange": { "predefined": "last30Days" },
    "dimensions": [
      { "dimensionType": "date", "column": null, "dateGranularity": "auto" }
    ],
    "dataset": {
      "type": "metric",
      "values": [
        {
          "type": "metric",
          "name": "Signup conversion",
          "metricId": "fact__signup_conv",
          "unit": "user_id",
          "denominatorUnit": null,
          "rowFilters": []
        }
      ]
    }
  }
}
```

## get a previous exploration

`GET /api/v1/product-analytics/analyticsExplorations/:id`

Use this only if the user references an older exploration by ID and the data isn't already in conversation history. Prefer the response of the most recent exploration call.

</endpoints>

<config_schema>
Top-level config: `{ type, datasource, chartType, dateRange, dimensions, dataset, showAs? }`

- `type`: `"metric" | "fact_table" | "data_source"` — must match the dataset.type and the endpoint you call.
- `chartType`: `"line" | "area" | "timeseries-table" | "table" | "bar" | "stackedBar" | "horizontalBar" | "stackedHorizontalBar" | "bigNumber"`
- `dateRange`: `{ predefined, lookbackValue?, lookbackUnit?, startDate?, endDate? }`
  - `lookbackUnit`: `"hour" | "day" | "week" | "month"`
- `dimensions`: array of dimension objects:
  - `date`: `{ dimensionType: "date", column: null, dateGranularity: "auto"|"hour"|"day"|"week"|"month"|"year" }`
  - `dynamic`: `{ dimensionType: "dynamic", column: string, maxValues: number (1-20) }`
- `dataset` for `type="metric"`: `{ type: "metric", values: [{ type: "metric", name, metricId, unit, denominatorUnit, rowFilters }] }`
- `dataset` for `type="fact_table"`: `{ type: "fact_table", factTableId, values: [{ type: "fact_table", name, valueType: "unit_count"|"count"|"sum", valueColumn, unit, rowFilters }] }`
- `rowFilters`: `[{ operator: "="|"!="|"in"|"not_in"|"contains"|"not_contains"|"starts_with"|"ends_with"|"is_null"|"not_null", column: string, values: string[] }]`
- `showAs` (optional): `"total" | "per_unit"` — chart-level toggle between raw totals and per-unit averages for mean metrics. Omit to use the smart default.

Always send a complete config object.
</config_schema>

<chart_rules>
Timeseries charts (line, area, timeseries-table): always include a date dimension.
Cumulative charts (bar, stackedBar, horizontalBar, stackedHorizontalBar, table, bigNumber): never include a date dimension.
When switching between timeseries and cumulative, add or remove the date dimension accordingly.
Default chartType: line for timeseries, bar for cumulative (when user doesn't specify).
NEVER use bigNumber unless the user explicitly asks for a big number or single-stat display. Always prefer bar chart for cumulative data.

CRITICAL — only 1 successful chart per response. NEVER produce more than one chart per turn.
If an exploration returns an error or 0 rows, you may retry with a corrected config — but once you get a successful non-empty result, that's the chart for this turn.
Combine multiple values into a single chart using `dataset.values` when possible.
If the user asks for data that spans both a fact table and a metric (different exploration types), pick the one that best answers the core question and tell the user the other cannot be plotted on the same chart.
</chart_rules>

<dimension_rules>
Only use `dimensionType: "dynamic"`. Never use `"static"` or `"slice"`.
"dynamic" shows the top N values for a column — set `maxValues` (1–20, default 5).
Use `dateGranularity: "auto"` by default for date dimensions; only use a specific granularity (hour/day/week/month/year) when the user requests it.
Maximum 2 total dimensions (including the date dimension for timeseries). If `dataset.values` has more than 1 entry, max 1 dimension.
bigNumber charts (only when explicitly requested): 0 dimensions and exactly 1 value.

IMPORTANT: Do NOT add breakdown dimensions unless the user explicitly asks to "break down by", "split by", "group by", or similar.
For timeseries charts, include only the date dimension by default.
For cumulative charts, include 0 dimensions by default — just show the total.
</dimension_rules>

<unit_rules>
Always follow the `unitNote` returned by the columns endpoint:

- fact_table valueType `"unit_count"`: set unit to userIdTypes[0] (e.g. "user_id") unless user specifies otherwise.
- fact_table valueType `"count"` or `"sum"`: unit must be null.
- metric: always set unit to userIdTypes[0] for standard metric types (mean, proportion, retention, dailyParticipation). The backend requires a unit to emit the denominator needed for per-unit rendering. For ratio and quantile metrics, leave unit null (they handle units internally).
- denominatorUnit: always null.

If you omit unit on a standard metric, the backend will fill in userIdTypes[0] automatically.
</unit_rules>

<show_as_rules>
`showAs` is an optional top-level field that toggles how numeric values are rendered: "total" shows the raw numerator, "per_unit" divides by the unit count (e.g. avg per user).

DEFAULT: Omit `showAs` in almost all cases. The UI infers a sensible default from the selected metrics — totals for most datasets, per-unit only for mean metrics whose aggregation makes totals incoherent (max, count distinct).

Set `showAs` explicitly ONLY when the user's request clearly asks for one view:

- "per user", "per device", "average per X", "rate" → `"per_unit"`
- "total X", "sum of X", "how much X did we have" → `"total"`

`showAs` has no effect on these dataset types — do not set it:

- fact_table / data_source datasets (always renders as the raw value)
- metric datasets where every value is a proportion, retention, dailyParticipation, ratio, or quantile metric

Set `showAs` only when at least one value is a mean metric.
</show_as_rules>

<value_column_rules>
For fact_table values:

- valueType `"count"`: valueColumn must be null.
- valueType `"unit_count"`: valueColumn must be null.
- valueType `"sum"`: valueColumn must be a numeric column from the columns endpoint.
  </value_column_rules>

<row_filter_rules>
rowFilters shape: `{ operator, column, values }`
Common operators: `"="`, `"!="`, `"in"`, `"not_in"`, `"contains"`, `"not_contains"`, `"starts_with"`, `"ends_with"`, `"is_null"`, `"not_null"`.
CRITICAL — never guess column values for filters. Always call `column-values` first. Pass a `searchTerm` for partial matches (e.g. "US" to find "United States").
`column-values` only works on string-typed columns.
</row_filter_rules>

<date_range_rules>
"last14Days" is NOT a valid predefined value. For 14 days use: `{ predefined: "customLookback", lookbackValue: 14, lookbackUnit: "day" }`.
Valid predefined values: `"today"`, `"last7Days"`, `"last30Days"`, `"last90Days"`, `"customLookback"`, `"customDateRange"`.
</date_range_rules>

<search_rules>
Always use the search endpoint to discover metrics and fact tables.
Pass an empty `query` to browse all items, or a search term to filter. Use `skip` and `limit` to paginate.
Each result includes an `explorerType` field ("metric" or "fact_table") indicating which exploration type to use, and a `kind` field with the specific result type.
Prefer metrics over fact tables when both could satisfy the user's request — metrics are pre-defined with curated logic and are more reliable.
Results include an `official` field: prefer official resources (`official: true`) over non-official ones, as they are vetted and authoritative.

CRITICAL search strategy:

- Keep search terms short and focused (1-3 words). Multi-word queries will match if ANY individual word hits, so "features experiments" will find items matching "features" OR "experiments". Exact and substring matches rank higher.
- If a specific search yields no results or only loosely related results, broaden your search. Try single generic keywords like "event", "count", "pageview", etc.
- Think creatively about which metric or fact table can answer the question. A generic metric (e.g. "count of events") with the right `rowFilters` applied can often answer questions that no specifically-named metric covers. Don't just settle for the first result — consider whether a more general resource + filters would be a better fit.
  </search_rules>

<response_style>
Keep responses brief and actionable. When discussing data, reference specific numbers from `exploration.result.rows`.
After running an exploration, respond with 1–2 sentences highlighting the key insight. Do not repeat the config or enumerate all data points.
If asked about metrics, fact tables, or tables that don't exist, let the user know.
</response_style>

<error_handling>
If a `callApi` response has a non-2xx `status`, analyze the error message in `body.message`, fix the config, and retry.
If you get the same or very similar error 3 times in a row, stop retrying — explain briefly what went wrong and suggest what the user can do differently.
If an exploration returns 0 rows, do NOT present this as a final answer. Treat it as a likely problem:

- Check that the date range covers a period with data (try widening it).
- Check that row filters aren't too restrictive (verify column values via `column-values`).
- Consider whether you picked the wrong metric or fact table and search for alternatives.
  Only after at least one retry should you tell the user no data was found.
  </error_handling>
