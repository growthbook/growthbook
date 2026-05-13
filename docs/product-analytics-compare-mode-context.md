# Product Analytics: Compare mode — context (fork this doc)

This file is a **standalone snapshot** of the Compare feature: goals, architecture, where code lives, and open knobs. Edit freely; it is **not** the locked product plan in `.cursor/plans/`.

---

## Product intent

- **Compare** toggles a second exploration for a **derived previous period** (same config, different `dateRange`).
- **Chart**: previous period series overlaid behind the current period (line/area), time-aligned so periods stack visually.
- **Table**: grouped headers (metric name spanning two sub-columns), **previous** then **current** period columns, **% change** on current cells only; **CSV** includes both period columns with flattened headers, **not** the trend.
- **UX**: two independent `POST /product-analytics/run` calls from the front-end; optional isolated `loading` for the second call via a second `useExploreData()` instance.

---

## Architecture (FE-only compare)

| Concern             | Approach                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Queries             | Two configs → two `fetchData` calls; no combined backend “compare” API.                                                                  |
| Comparison window   | `buildComparisonDateRange()` in shared (`packages/shared/src/enterprise/product-analytics/compare-date-range.ts`).                       |
| Merge / overlay / % | All on the front-end.                                                                                                                    |
| Loading             | Second `useExploreData()` in `ExplorerProvider` keeps main `loading` independent; toolbar shows `comparisonLoading` / `comparisonError`. |

---

## Key files (implementation map)

| Area                                  | Path                                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Comparison `dateRange` helper + tests | `packages/shared/src/enterprise/product-analytics/compare-date-range.ts`, `packages/shared/test/compare-date-range.test.ts` |
| Re-export                             | `packages/shared/src/enterprise/index.ts`                                                                                   |
| State + fetches                       | `packages/front-end/enterprise/components/ProductAnalytics/ExplorerContext.tsx`                                             |
| Toolbar switch + status               | `packages/front-end/enterprise/components/ProductAnalytics/MainSection/Toolbar/index.tsx`                                   |
| Chart overlay                         | `packages/front-end/enterprise/components/ProductAnalytics/MainSection/ExplorerChart.tsx`                                   |
| Table + hook                          | `packages/front-end/enterprise/components/ProductAnalytics/MainSection/useExplorationTableData.tsx`                         |
| Table wiring                          | `packages/front-end/enterprise/components/ProductAnalytics/MainSection/ExplorerDataTable.tsx`, `ExplorerMainSection.tsx`    |
| CSV + custom cells                    | `packages/front-end/components/Settings/DisplayTestQueryResults.tsx`                                                        |

---

## Comparison period rules (helper)

- **last7Days / last30Days / last90Days / customLookback**: resolve current window with `calculateProductAnalyticsDateRange`, shift back by one span, emit **`customDateRange`** with `yyyy-MM-dd` UTC bounds.
- **today**: previous **UTC calendar day** as `customDateRange` (same start/end date string).
- **customDateRange**: **`subYears(..., 1)`** on both bounds.

---

## Deliberate v1 limits (good follow-up topics)

1. **Ratio metrics**  
   Table compare layout is **disabled** when any ratio (numerator/denominator/value) columns exist — avoids a third header row. Chart overlay may still apply for line/area.

2. **Chart types**  
   Overlay only for **line** and **area**. Bars / stacked / big number: no overlay (could add callouts later).

3. **Table row join**  
   Current vs previous rows aligned by **sort order + index** after `sortExplorationRows`. Mismatched lengths → missing previous cells for trailing rows.

4. **Dashboard / embedded explorer**  
   `ExplorerDataTable` accepts optional `compareEnabled` / `comparisonExploration`; callers outside `ExplorerProvider` default compare off.

---

## API surface (Explorer context)

Consumers under `ExplorerProvider` can use:

- `compareEnabled`, `setCompareEnabled`
- `comparisonExploration`, `comparisonQuery`, `comparisonError`, `comparisonLoading` (from second hook)

---

## CSV / table contract

- **`csvColumnKeys` / `csvColumnLabels`**: passed when compare table is active; headers like `{Metric} — {range}`.
- **`renderCell`**: adds trend under `__curr` cells; trend stored in row as `__trend` keys **not** listed in `csvColumnKeys`.

---

## Ideas for your follow-ups

- Enable compare table for **ratio** metrics (header design: 3 rows vs split tables).
- **Bar chart** overlay or small-multiple compare.
- **Persist** `compareEnabled` in URL or `localStorage`.
- **Join strategy**: match on non-date dimensions instead of index zip.
- **Backend** coalesced run if warehouse cost becomes an issue (see original plan “Scalability” section).

---

## Related locked plan (read-only reference)

The approved feature plan with todos lives outside this repo’s editable doc set, e.g.  
`~/.cursor/plans/product_analytics_compare_bbe9aefc.plan.md` — treat this **context** file as your working notes; keep the plan file unchanged unless you intentionally update the official plan.
