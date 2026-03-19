# RFC: Single-Scan CUPED Fact Table

**Status:** Draft
**PR:** (link after creation)

## Problem

`getExperimentFactMetricsQuery()` (`SqlIntegration.ts:~3147`) generates experiment analysis SQL with a `__factTable` CTE that is **referenced twice** when regression adjustment (CUPED) is enabled:

| CTE | Join | Purpose | Line |
|---|---|---|---|
| `__userMetricJoin` | `LEFT JOIN __factTable m ON m.id = d.id` | Post-exposure metric values | ~3454 |
| `__userCovariateMetric` | `JOIN __factTable m ON m.id = d.id` | Pre-exposure CUPED covariates | ~3056 (via `getCovariateMetricCTE`) |

Most analytical warehouses (BigQuery, Snowflake, Redshift, Databricks SQL) inline CTEs rather than materialize them. Result: **the fact table is scanned twice per query**.

### Cost impact

For a typical CUPED experiment:
- Fact table window = experiment duration + `regressionAdjustmentHours` lookback
- 26 metrics, 336-hour (14-day) CUPED lookback, 28-day experiment → 42-day scan window
- Fact tables are often the widest tables (event-grain, many columns) → the scan is the dominant cost
- **Double-scan → ~2× bytes billed for every CUPED-enabled experiment refresh**

## Why the second scan is redundant

`metricStart` (line ~2869) already subtracts `regressionAdjustmentHours`:

```ts
const metricStart = getMetricStart(
  settings.startDate,
  minMetricDelay,
  regressionAdjustmentHours  // ← lookback already included
);
```

So `__factTable`'s `WHERE m.timestamp >= metricStart` **already includes all pre-exposure rows**. Scan #2 re-reads bytes scan #1 already loaded.

Both joins also use the **identical join key** (`m.${baseIdType} = d.${baseIdType}`). The only difference is the timestamp window predicate in the SELECT, which is already done via CASE WHEN.

## Design

### Before
```
__factTable          ← fact SQL, date-filtered [metricStart, metricEnd]
__userMetricJoin     ← d LEFT JOIN __factTable, SELECT post-exposure CASE WHEN cols
__userCovariateMetric ← d INNER JOIN __factTable, aggregate pre-exposure CASE WHEN cols
                        WHERE m.ts >= d.min_preexposure_start AND m.ts < d.max_preexposure_end
```

### After
```
__factTable          ← unchanged
__userMetricJoin     ← d LEFT JOIN __factTable, SELECT post-exposure AND pre-exposure CASE WHEN cols
__userCovariateMetric ← GROUP BY over __userMetricJoin (no __factTable reference)
```

### Code changes

**1. `__userMetricJoin` SELECT** (inside `factTablesWithIndices.map`, ~line 3410–3457)

For each metric in `regressionAdjustedMetrics` where `numeratorSourceIndex === f.index`, emit additional columns alongside existing post-exposure columns:

```ts
// Existing post-exposure column (unchanged):
, (CASE WHEN m.timestamp >= d.timestamp AND m.timestamp <= ${endDate}
   THEN m.${alias}_value ELSE NULL END) AS ${alias}_value

// NEW: pre-exposure covariate column
, (CASE WHEN m.timestamp >= d.${alias}_preexposure_start
        AND m.timestamp <  d.${alias}_preexposure_end
   THEN m.${alias}_value ELSE NULL END) AS ${alias}_covariate_value
```

Same for `_denominator` columns on ratio metrics.

**2. `getCovariateMetricCTE` body** (~line 3019–3065)

Replace the `JOIN __factTable` with a `GROUP BY` over `__userMetricJoin`:

```sql
SELECT
  umj.variation,
  umj.${baseIdType},
  ${aggFn}(umj.${alias}_covariate_value) AS ${alias}_value,
  ${aggFn}(umj.${alias}_covariate_denominator) AS ${alias}_denominator
FROM __userMetricJoin${suffix} umj
GROUP BY umj.variation, umj.${baseIdType}
```

Output column names (`${alias}_value`, `${alias}_denominator`) are **unchanged** — downstream consumers don't change.

## Semantics proof

The original CTE uses `INNER JOIN` — users with zero pre-exposure events are **absent** from the CTE output. The new version uses `LEFT JOIN + CASE WHEN` — those users are **present** with NULL covariate columns, which aggregate to 0.

Downstream consumption (verified):

| Site | Code | NULL handling |
|---|---|---|
| `SqlIntegration.ts:~4393,4503,4809` | `LEFT JOIN __userCovariateMetric c ON ...` | Already LEFT — absent users already produce `c.X = NULL` |
| `capCoalesceValue()` (~line 5080–5127) | `COALESCE(${valueCol}, 0)` in all branches | NULL → 0 |

| User profile | Original path | New path | Final value |
|---|---|---|---|
| 0 pre-exposure events | absent from CTE → `c.X=NULL` → `COALESCE(NULL,0)` | `SUM(COALESCE(NULL,0))=0` or `COUNT(NULL)=0` → `c.X=0` → `COALESCE(0,0)` | **0 = 0** ✓ |
| ≥1 pre-exposure event | normal aggregation | same aggregation, different path | **identical** ✓ |

## Scope

**In scope:**
- `getExperimentFactMetricsQuery` (fact-table metrics, ~line 3147)

**Out of scope (follow-up):**
- `getExperimentMetricQuery` (legacy non-fact metrics, ~line 3838) — same pattern with `__metric` CTE, same fix applies
- `getIncrementalRefreshStatisticsQuery` (~line 7762) — already reads from physical tables, no double-scan

## Testing

- [ ] Snapshot tests regenerated — expect SQL structure changes, final SELECT columns identical
- [ ] Manual byte-count verification on BigQuery: run a CUPED experiment query before/after, compare `INFORMATION_SCHEMA.JOBS_BY_PROJECT.total_bytes_billed`
- [ ] Numerical verification: run same experiment on same data, diff the output rows — should be bit-identical
