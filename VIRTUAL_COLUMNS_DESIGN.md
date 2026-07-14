# Design: Virtual Columns for Fact Tables

**Status:** Draft / RFC
**Area:** Fact Tables (`packages/front-end/pages/fact-tables/[ftid].tsx`)
**Author:** _nhatho_

**Last updated:** 2026-07-13

---

## 1. Summary

Add a new **Virtual Columns** tab to the Fact Table page that lets users define
**computed columns** from existing fact table columns using a raw SQL expression
(e.g. `price * quantity`, `first_name || ' ' || last_name`,
`DATE_DIFF(shipped_at, ordered_at, DAY)`).

Once created, a virtual column behaves like any other fact table column: it can be
selected as a metric value/numerator/denominator, used in row filters, and used as a
slice dimension. The expression is **inlined into the generated SQL** (SELECT and
WHERE), so users never have to edit the fact table's base query.

### User-facing description (tab copy)

> **Virtual Columns** let you define computed columns from your existing fact table
> columns — arithmetic on numbers, concatenation on strings, date math, or any SQL
> expression. Once created, a virtual column works like any other column: use it in
> metrics, row filters, and slices. The expression is added to the generated SQL for
> you, so there's no need to edit the fact table's SQL query.

---

## 2. Design principle: one injection point

Every place that turns a column reference into SQL flows through a single function:

- `getColumnExpression(column, factTable, jsonExtract, alias)` —
  `[packages/shared/src/experiments/experiments.ts:132](packages/shared/src/experiments/experiments.ts)`
  Returns `alias.column` for a plain column, or a `jsonExtract(...)` for a JSON subfield.

The core insight: **if a virtual column carries a stored SQL expression and**
`getColumnExpression` **returns that expression instead of** `alias.column`**, the virtual
column works everywhere a normal column does** — the SELECT clause of a metric value,
the WHERE clause of a row filter, and slice breakdowns — with almost no other wiring.

The parallel chokepoint for datatype resolution is
`getSelectedColumnDatatype({ factTable, column })`
(`[experiments.ts:549](packages/shared/src/experiments/experiments.ts)`), through which the
virtual column's user-declared datatype drives which aggregations and row-filter
operators are offered.

**Consequence:** we store virtual columns _inside the existing_ `columns[]` _array_
(not a separate array like `filters[]`). Because a virtual column _is_ a column, it
then shows up automatically in `getColumnOptions`, `ColumnRefSelector`,
`RowFilterInput`, `FactTableSchema`, and every other picker that reads
`factTable.columns` — with near-zero additional wiring.

---

## 3. Data model

Extend `ColumnInterface`
(`[packages/shared/types/fact-table.d.ts:35](packages/shared/types/fact-table.d.ts)`) and the
Zod validators with the following fields:

```ts
interface ColumnInterface {
  // ...existing fields...
  isVirtual?: boolean; // true = user-defined computed column, not SQL-detected
  sql?: string; // the raw expression, e.g. "price * quantity"
  dependsOn?: string[]; // column names referenced by `sql` (for referential integrity)
}
```

Notes:

- `column` (the existing key field) is reused as the virtual column's stable
  identifier/name. It must be unique within the fact table and must not collide with a
  real column name. Recommend generating a safe identifier from the display name (e.g.
  slugify) and disallowing names that match an existing column.
- `datatype` is **user-declared** (number/string/date/boolean/…), not inferred,
  since the expression's result type is chosen by the user. This gates valid
  aggregations and operators through the existing datatype machinery.
- `dependsOn` is populated by the guided builder (see §7). For free-form SQL it is
  best-effort (see §9).

### Validators

In `[packages/shared/src/validators/fact-table.ts](packages/shared/src/validators/fact-table.ts)`:

- Add `isVirtual`, `sql`, `dependsOn` to `createColumnPropsValidator` (L51) and
  `updateColumnPropsValidator` (L68).
- Add matching fields to `apiFactTableColumnValidator` (L333) for the external REST API.
- New `testVirtualColumnPropsValidator`: `{ sql: z.string(), datatype: factTableColumnTypeValidator }.strict()`
  (mirrors `testFactFilterPropsValidator` at L324).

### Mongoose schema

Add `isVirtual`, `sql`, `dependsOn` to the `columns` sub-schema in
`[packages/back-end/src/models/FactTableModel.ts:46](packages/back-end/src/models/FactTableModel.ts)`,
and add them to `ALLOWED_COLUMN_UPDATE_FIELDS`
(`[FactTableModel.ts:387](packages/back-end/src/models/FactTableModel.ts)`) if virtual columns
should be updatable by the background/cron-safe path.

---

## 4. Back-end: routes, controllers, model

### New / changed routes

In `[packages/back-end/src/routers/fact-table/fact-table.router.ts](packages/back-end/src/routers/fact-table/fact-table.router.ts)`:

| Method   | Path                                   | Handler                           | Notes                                                                                                                      |
| -------- | -------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/fact-tables/:id/column`              | `postColumn` **(new)**            | Column creation currently has **no route** — the ColumnModal "Add Column" POST is a dead path. Needed for virtual columns. |
| `PUT`    | `/fact-tables/:id/column/:column`      | `putColumn` (existing)            | Reused for editing a virtual column's `sql`/`datatype`/name.                                                               |
| `DELETE` | `/fact-tables/:id/column/:column`      | `deleteColumn` **(new)**          | Needed to remove a virtual column (real columns are only soft-deleted via SQL refresh).                                    |
| `POST`   | `/fact-tables/:id/test-virtual-column` | `postVirtualColumnTest` **(new)** | Mirrors `postFactFilterTest`.                                                                                              |

### Test-query handler

Mirror `testFilterQuery` (`[fact-table.controller.ts:94](packages/back-end/src/routers/fact-table/fact-table.controller.ts)`).
Where the filter test wraps the SQL as `SELECT * FROM (${sql}) f WHERE <value>`, the
virtual-column test wraps it as:

```sql
SELECT <expr> AS <name>, *
FROM (
  ${factTable.sql}
) f
LIMIT <n>
```

Run via `integration.getTestQuery` / `integration.runTestQuery` and return
`FactFilterTestResults`-shaped output (`{ sql, duration?, error?, results? }`). Reuse
the same permission check (`canRunTestQueries`).

### Create/update/delete model methods

- `createColumn(context, factTable, data)` **(new)** — validate uniqueness of `column`,
  validate it does not collide with a real column, `$push` into `columns[]`. For virtual
  columns require `isVirtual: true` + non-empty `sql` + explicit `datatype`.
- `updateColumn` (existing, `[FactTableModel.ts:545](packages/back-end/src/models/FactTableModel.ts)`)
  — already merges arbitrary column changes; works for editing `sql`/`datatype`.
- `deleteColumn(context, factTable, column)` **(new)** — for virtual columns, hard-remove
  from `columns[]`. Must run the referential-integrity checks in §8 first.

### Permissions & commercial gating

- Creating/updating/deleting virtual columns reuses `canUpdateFactTable(factTable, { columns: [] })`
  (the "edit columns" permission already used by `putColumn`,
  `[fact-table.controller.ts:864](packages/back-end/src/routers/fact-table/fact-table.controller.ts)`).
- Testing reuses `canRunTestQueries(datasource)`.
- **Open question:** should virtual columns be a commercial/enterprise feature? If so,
  gate with `hasCommercialFeature(...)` (front-end) / `context.hasPremiumFeature(...)`
  (back-end), following the `metric-slices` pattern. _Decision needed._

---

## 5. SQL generation — the core change

In `getColumnExpression` (`[experiments.ts:132](packages/shared/src/experiments/experiments.ts)`),
add a branch before the JSON/plain-column logic:

```ts
export function getColumnExpression(
  column,
  factTable,
  jsonExtract,
  alias = "",
) {
  const col = factTable.columns.find((c) => c.column === column);
  if (col?.isVirtual && col.sql) {
    // Qualify referenced columns with the alias and inline the expression.
    return `(${qualifyColumns(col.sql, factTable, alias)})`;
  }
  // ...existing JSON subfield + plain-column logic...
}
```

Where `qualifyColumns` rewrites bare column identifiers in the expression to
`alias.<col>` so the expression is valid inside the CTE/join context. (If aliasing
proves fragile for arbitrary SQL, an alternative is to require the fact table subquery
to always be aliased as `f` and document that expressions reference bare column names.)

Because all these consumers already call `getColumnExpression`, they get virtual-column
support for free:

- Metric value/numerator SQL — `getFactMetricColumn`
  (`[integrations/sql/columns/fact-metric-column.ts:42](packages/back-end/src/integrations/sql/columns/fact-metric-column.ts)`)
  and `getMetricColumns`
  (`[metric-columns.ts:56](packages/back-end/src/integrations/sql/columns/metric-columns.ts)`).
- Row-filter WHERE SQL — `getRowFilterSQL` / `getColumnRefWhereClause`
  (`[experiments.ts:159](packages/shared/src/experiments/experiments.ts)`).
- Slice WHERE SQL — the slice branch of `getColumnRefWhereClause`
  (`[experiments.ts:184](packages/shared/src/experiments/experiments.ts)`).
- Enterprise product-analytics SQL — `[shared/src/enterprise/product-analytics/sql.ts](packages/shared/src/enterprise/product-analytics/sql.ts)`
  (L430, L441, L796 all call `getColumnExpression`).

---

## 6. Where virtual columns must integrate (usage map)

The table below is the complete inventory of where `factTable.columns` is consumed.
Sites marked **auto** work with no change once the column lives in `columns[]` and
`getColumnExpression` handles it; sites marked **touch** need explicit handling.

| Area                              | Site                                                                                                                                                                                                                              | Status                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Metrics UI**                    | `getColumnOptions` + `ColumnRefSelector` — `[FactMetricModal.tsx](packages/front-end/components/FactTables/FactMetricModal.tsx)`                                                                                                  | auto, show indicator that this is a virtual column                             |
| Metric formatters                 | `[services/metrics.tsx](packages/front-end/services/metrics.tsx)`                                                                                                                                                                 | auto                                                                           |
| **Row filters UI**                | `[RowFilterInput.tsx](packages/front-end/components/FactTables/RowFilterInput.tsx)`, `[rowFilterUtils.ts](packages/front-end/components/FactTables/rowFilterUtils.ts)`                                                            | auto                                                                           |
| **Slices UI**                     | `[FactTableAutoSliceSelector.tsx](packages/front-end/components/FactTables/FactTableAutoSliceSelector.tsx)`, `CustomMetricSlicesSelector`                                                                                         | touch — decide if virtual columns are slice-eligible                           |
| **SQL: metric value**             | `getFactMetricColumn`, `getMetricColumns`                                                                                                                                                                                         | auto (via `getColumnExpression`)                                               |
| **SQL: row filter / slice WHERE** | `getColumnRefWhereClause`, `getRowFilterSQL`                                                                                                                                                                                      | auto                                                                           |
| **SQL: aggregation fns**          | `[aggregation-metadata.ts](packages/back-end/src/integrations/sql/fact-metrics/aggregation-metadata.ts)`                                                                                                                          | auto (keys off datatype/aggregation, not column origin)                        |
| **SQL: aggregated fact tables**   | `[aggregated-fact-table-schema.ts](packages/back-end/src/integrations/sql/fact-metrics/aggregated-fact-table-schema.ts)` + insert query builders                                                                                  | **touch — see §10**                                                            |
| **Validation**                    | `validateSettings`/`validateSavedFilterIds` in `[FactMetricModel.ts](packages/back-end/src/models/FactMetricModel.ts)`, `[factMetricAggregationValidation.ts](packages/back-end/src/services/factMetricAggregationValidation.ts)` | auto (resolves via `getSelectedColumnDatatype`)                                |
| **Column list UI**                | `[ColumnList.tsx](packages/front-end/components/FactTables/ColumnList.tsx)`                                                                                                                                                       | touch — decide whether virtual columns appear here too, or only in the new tab |
| **Schema/autocomplete**           | `[FactTableSchema.tsx](packages/front-end/components/FactTables/FactTableSchema.tsx)`, `sqlAutoComplete`                                                                                                                          | auto                                                                           |
| **Column refresh**                | `mergeColumnsWithTypeMap`, `runRefreshColumnsQuery`                                                                                                                                                                               | **touch — see §9 (must skip virtual columns)**                                 |

---

## 7. Front-end: the new tab

### Tab wiring

In `[packages/front-end/pages/fact-tables/[ftid].tsx](packages/front-end/pages/fact-tables/[ftid].tsx)`,
add a third `<TabsTrigger value="virtual-columns">` next to Metrics and Saved Filters
(around L532–582), with a `<Badge>` count, and a `<TabsContent>` rendering a new
`VirtualColumnList` component.

### `VirtualColumnList.tsx` (new)

Clone `[FactFilterList.tsx](packages/front-end/components/FactTables/FactFilterList.tsx)`:
searchable/paginated table of `factTable.columns.filter(c => c.isVirtual && !c.deleted)`,
columns for **Name**, **Expression** (`<InlineCode language="sql" code={col.sql} />`),
**Type**, and a row menu (Edit/Delete). Add button gated by the edit-columns permission.

### `VirtualColumnModal.tsx` (new)

Clone `[FactFilterModal.tsx](packages/front-end/components/FactTables/FactFilterModal.tsx)`. Fields:

- **Name** (display name → identifier).
- **Data type** — SelectField (drives valid downstream aggregations/operators).
- **Expression (SQL)** — textarea; the value inlined by `getColumnExpression`.
- **Guided builder (optional but recommended):** pick two-or-more columns of the _same_
  datatype + an operator (`+ − × ÷` for numbers, `||`/concat for strings, date-diff for
  dates). Emits the SQL into the textarea **and** records `dependsOn`. A free-form SQL
  escape hatch remains for advanced expressions.
- **Test Query** button + **Test before saving** checkbox — reuse the
  `POST /fact-tables/:id/test-virtual-column` endpoint and `DisplayTestQueryResults`
  verbatim.
- **Available columns** sidebar — reuse `<FactTableSchema factTable={factTable} />`.

### Same-type arithmetic / string ops

Enforced in two layers:

1. **UI (soft):** the guided builder only lets you combine columns of matching datatypes
   and offers operators appropriate to that type.
2. **Warehouse (hard):** the "Test before saving" run is the real correctness gate — the
   warehouse validates the expression, exactly as it does for Saved Filters today.

---

## 8. Referential integrity — deleting/removing a _referenced_ column

This is the case: a real column that a virtual column depends on is removed (from the
fact table SQL) or a virtual column it depends on is deleted.

### Current reality (no special handling = silent break)

Virtual column `sql` is **opaque text**. Nothing links `margin = price * quantity` to
the `price` column, so by default deleting `price` does **not** invalidate `margin`. The
broken expression stays and fails only at test/query time. This matches how **Saved
Filters** already behave (their `value` SQL is not validated against column existence on
column deletion).

Contrast: **structured** references _are_ cascade-cleaned today — `metricAutoSlices` are
stripped by `detectRemovedColumns` [+](packages/back-end/src/models/FactTableModel.ts) `cleanupMetricAutoSlices`
when a column disappears. Virtual columns can join that mechanism _if_ we track
dependencies.

### Proposed behavior

Use `dependsOn` to make dependencies structured, then hook the existing cascade:

1. **On column soft-delete / removal** (in `updateColumn` and the refresh path, where
   `detectRemovedColumns` already runs): find virtual columns whose `dependsOn` includes
   a removed column. **Do not hard-delete them.** Instead mark them invalid — either set
   `deleted: true` or a new `invalid?: boolean` / `invalidReason?: string` flag — so the
   UI can show _"references removed column_ `price`_"_ and pickers can exclude/flag them.
2. **Virtual-column dependency chains** (`margin → margin_pct`): resolve transitively.
   When `price` is removed, invalidate `margin`, then anything depending on `margin`, etc.
   A simple repeated pass over `columns` until no new invalidations is sufficient
   (virtual-column counts are small).
3. **Free-form SQL** (no reliable `dependsOn`): fall back to a best-effort text scan for
   the removed column name and surface a **warning banner** rather than auto-invalidating
   (avoids false positives from substring matches). See §9.
4. **Deleting a virtual column that others depend on** (`deleteColumn`): block the delete
   with a clear error listing the dependents (mirrors how `deleteFactFilter`
   `[fact-table.controller.ts:1021](packages/back-end/src/routers/fact-table/fact-table.controller.ts)`
   blocks deletion when a segment references the filter), or offer a cascade.

**Recommendation:** structured `dependsOn` + cascade (options 1–2, 4) for the guided
builder; best-effort warning (option 3) for free-form SQL.

---

## 9. Referential integrity — the _reverse_ direction (refresh deleting virtual columns)

The column-refresh logic marks any column **not present in the SQL output schema** as
`deleted: true`:

- `mergeColumnsWithTypeMap` — `[fact-table.controller.ts:143](packages/back-end/src/routers/fact-table/fact-table.controller.ts)`
- `runRefreshColumnsQuery` — `[packages/back-end/src/jobs/refreshFactTableColumns.ts](packages/back-end/src/jobs/refreshFactTableColumns.ts)`

A virtual column is a computed expression that will **never** appear in
`SELECT * FROM (sql)`, so **both refresh paths would delete every virtual column on each
SQL edit or background refresh.**

**Required fix:** both paths must **skip** `isVirtual` **columns** — exclude them from the
"mark as deleted if absent from typeMap" step and preserve them untouched. This is the
single most important correctness point of the implementation.

---

## 10. Aggregated (materialized) fact tables

If the fact table uses the data pipeline (`aggregatedFactTableSettings`), metric SQL is
generated against a **materialized** table, not the raw SQL. The materialized schema is
built by
`[aggregated-fact-table-schema.ts](packages/back-end/src/integrations/sql/fact-metrics/aggregated-fact-table-schema.ts)`
and the insert queries in
`[packages/back-end/src/integrations/sql/queries/](packages/back-end/src/integrations/sql/queries/)`.

Because virtual columns resolve through `getColumnExpression` at _metric_ SQL-build time,
they should expand correctly against the materialized table **as long as the columns they
reference are themselves materialized**. Two options:

1. **Inline at query time** (simplest): the virtual expression is computed from the
   materialized base columns whenever a metric uses it. Requires that all `dependsOn`
   columns are present in the aggregated table.
2. **Materialize the virtual column** (faster, more complex): add it as a computed column
   in the CREATE/INSERT so it's precomputed. Larger change to the schema/insert builders.

**Recommendation:** start with option 1 and explicitly validate that a virtual column's
dependencies are materialized before allowing its use in a pipeline metric. _Confirm with
whoever owns the pipeline code before finalizing._

---

## 11. Edge cases & open questions

- **Naming/identity:** how is the stable `column` key generated, and how do we prevent collision with a real column that later appears via SQL refresh? Maybe add a `vc_` prefix before column id provided by users to be safe.
- **Commercial gating:** enterprise-only or free? (§4) Free
- **Slice eligibility:** can a virtual column be an auto-slice / custom-slice dimension? (§6) Yes
- **Appearance in** `ColumnList`**:** show virtual columns in the main Columns list too, or only in the new tab? Only in new tab, unless ColumnList is being used elsewhere.
- **External REST API:** the update-fact-table API currently forbids creating columns
  (["cannot create new columns via API"](packages/back-end/src/api/fact-tables/updateFactTable.ts)). Decide whether virtual columns are creatable via the public API and, if so, add the needed handler + docs. NO, let's not support this for now.
- `aggregateFilterColumn` **/ KLL** `_n_events`**:** virtual columns as aggregate-filter or quantile-count columns — validate or explicitly disallow. Validate

---

## 12. Phased implementation plan

1. **Model + SQL core (highest risk, do first)**

- Add `isVirtual`/`sql`/`dependsOn` to types, validators, Mongoose schema.
- Branch in `getColumnExpression` (§5).
- **Skip virtual columns in both refresh paths** (§9).
- Unit tests for `getColumnExpression` and refresh-skip.

2. **Back-end CRUD + test endpoint**

- `postColumn` / `deleteColumn` routes + model methods; `postVirtualColumnTest`.
- Referential-integrity checks (§8) in `updateColumn`/refresh/`deleteColumn`.

3. **Front-end tab + list + modal**

- New `virtual-columns` tab in `[ftid].tsx`; `VirtualColumnList` + `VirtualColumnModal`
  (clone the Fact Filter components); Test Query UX.

4. **Guided builder +** `dependsOn` **capture** (§7).
5. **Integration polish**

- Group/label virtual columns in `getColumnOptions`; slice eligibility decision;
  invalid-reference warnings in the UI.

6. **Aggregated fact tables** (§10) — validate/support pipeline usage.
7. **External API + docs** (if in scope).

---

## Appendix: reference map

| Concern                                              | File                                                                                                                                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fact Table page / tabs                               | `[packages/front-end/pages/fact-tables/[ftid].tsx](packages/front-end/pages/fact-tables/[ftid].tsx)`                                                                                                                |
| Column type + interface                              | `[packages/shared/types/fact-table.d.ts](packages/shared/types/fact-table.d.ts)`                                                                                                                                    |
| Validators (Zod + API)                               | `[packages/shared/src/validators/fact-table.ts](packages/shared/src/validators/fact-table.ts)`                                                                                                                      |
| Column → SQL / datatype helpers                      | `[packages/shared/src/experiments/experiments.ts](packages/shared/src/experiments/experiments.ts)`                                                                                                                  |
| Routes                                               | `[packages/back-end/src/routers/fact-table/fact-table.router.ts](packages/back-end/src/routers/fact-table/fact-table.router.ts)`                                                                                    |
| Controllers (incl. test-filter, refreshColumns)      | `[packages/back-end/src/routers/fact-table/fact-table.controller.ts](packages/back-end/src/routers/fact-table/fact-table.controller.ts)`                                                                            |
| Model (columns/filters persistence, cascade cleanup) | `[packages/back-end/src/models/FactTableModel.ts](packages/back-end/src/models/FactTableModel.ts)`                                                                                                                  |
| Column refresh job                                   | `[packages/back-end/src/jobs/refreshFactTableColumns.ts](packages/back-end/src/jobs/refreshFactTableColumns.ts)`                                                                                                    |
| Metric SQL columns                                   | `[packages/back-end/src/integrations/sql/columns/](packages/back-end/src/integrations/sql/columns/)`                                                                                                                |
| Aggregated fact table SQL                            | `[packages/back-end/src/integrations/sql/fact-metrics/aggregated-fact-table-schema.ts](packages/back-end/src/integrations/sql/fact-metrics/aggregated-fact-table-schema.ts)`                                        |
| Saved Filter UI (clone source)                       | `[packages/front-end/components/FactTables/FactFilterList.tsx](packages/front-end/components/FactTables/FactFilterList.tsx)`, `[FactFilterModal.tsx](packages/front-end/components/FactTables/FactFilterModal.tsx)` |
| Metric column picker                                 | `[packages/front-end/components/FactTables/FactMetricModal.tsx](packages/front-end/components/FactTables/FactMetricModal.tsx)`                                                                                      |
| Row filter picker                                    | `[packages/front-end/components/FactTables/RowFilterInput.tsx](packages/front-end/components/FactTables/RowFilterInput.tsx)`                                                                                        |
