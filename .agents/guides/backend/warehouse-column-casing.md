# Warehouse column-name casing

The column names GrowthBook sees in a query result are not always the names that
were written in the SQL. Two independent actors decide the final casing, and
confusing them causes real bugs — a configured `userId` looking "missing"
because the warehouse echoed back `userid`.

Casing below is for an unquoted alias `SELECT 1 AS userId`, which is what
GrowthBook receives as row-object keys and in the `columns` metadata list.

## 1. The warehouse decides what it echoes back

Two separate properties, both the engine's rule and outside our control:

- **Folding** — the case an unquoted identifier comes back as.
- **Identifier resolution** — whether `userId` and `userid` refer to the same
  column in SQL.

| Warehouse              | Unquoted folding      | Receives `userId` as     | Identifier resolution |
| ---------------------- | --------------------- | ------------------------ | --------------------- |
| Postgres               | lowercase             | `userid`                 | case-insensitive      |
| Redshift               | lowercase             | `userid`                 | case-insensitive      |
| Vertica                | lowercase             | `userid`                 | case-insensitive      |
| Adobe EP Query Service | lowercase             | `userid`                 | case-insensitive      |
| Presto / Trino         | preserves alias label | `userId`                 | case-insensitive      |
| Athena                 | preserves alias label | `userId`                 | case-insensitive      |
| Snowflake              | uppercase             | `USERID` from the driver | case-insensitive      |
| BigQuery               | preserves             | `userId`                 | case-insensitive      |
| Databricks             | preserves             | `userId`                 | case-insensitive      |
| MySQL                  | preserves             | `userId`                 | case-insensitive      |
| MSSQL                  | preserves             | `userId`                 | case-insensitive      |
| ClickHouse             | none (case-sensitive) | `userId`                 | case-sensitive        |

Notes:

- Postgres, Redshift, Vertica, and Adobe all go through `runPostgresQuery`; the
  `pg` client returns whatever the engine folded to.
- ClickHouse is the only case-sensitive engine — `userId` and `userid` are
  distinct columns.
- Quoted identifiers (`SELECT 1 AS "userId"`) preserve case on every warehouse;
  folding only applies to unquoted identifiers.

## 2. GrowthBook decides how to normalize and compare

After the driver returns data, GrowthBook may rewrite names and must choose how
to match a configured name against a warehouse-returned one.

- **Normalization on read.** Snowflake is post-processed (`services/snowflake.ts`)
  to lowercase both row keys and the `columns` list, so the rest of the back-end
  sees `userid` rather than `USERID`. No other integration rewrites column-name
  case. Within one integration, metadata-name casing always matches row-key
  casing, so a type map can be keyed the same way as the row objects.
- **Matching configured vs returned names.** Default is case-insensitive (both
  sides folded to lowercase); case-sensitive engines compare exactly. Integrations
  expose this choice via the `columnNamesAreCaseSensitive` flag (`true` on
  ClickHouse, `false` by default). Stored names keep the casing we persisted —
  GrowthBook does not fold on write.
- **JSON sub-fields are their own case rule.** Keys read from actual JSON values
  are literally case-sensitive regardless of the engine; only sub-fields
  described by warehouse schema metadata follow the identifier casing rule above.
- **Generated aliases.** Experiment and metric SQL uses GrowthBook-chosen
  lowercase snake_case aliases. We control both the alias and the reader, so
  those paths never depend on user column casing.
