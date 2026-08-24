# Warehouse column-name casing

Two owners. Do not mix them up.

1. The warehouse. Unquoted identifiers are folded (or not) by the engine. Quoted identifiers keep their case on every warehouse we support.
2. GrowthBook. After the driver returns rows and column metadata, we may rewrite names, and we choose how to compare a configured name to a warehouse-returned name.

Casing below is for an unquoted alias `SELECT 1 AS userId`. That is what GrowthBook receives as row-object keys and as the `columns` metadata list, except where noted.

## Out of our control

The warehouse picks the case it echoes back. Identifier resolution (whether `userId` and `userid` are the same column in SQL) is also the warehouse's rule.

| Warehouse              | Unquoted folding      | GrowthBook receives `userId` as | Identifier resolution |
| ---------------------- | --------------------- | ------------------------------- | --------------------- |
| Postgres               | lowercase             | `userid`                        | case-insensitive      |
| Redshift               | lowercase             | `userid`                        | case-insensitive      |
| Vertica                | lowercase             | `userid`                        | case-insensitive      |
| Adobe EP Query Service | lowercase             | `userid`                        | case-insensitive      |
| Presto / Trino         | preserves alias label | `userId`                        | case-insensitive      |
| Athena                 | preserves alias label | `userId`                        | case-insensitive      |
| Snowflake              | uppercase             | `USERID` from the driver        | case-insensitive      |
| BigQuery               | preserves             | `userId`                        | case-insensitive      |
| Databricks             | preserves             | `userId`                        | case-insensitive      |
| MySQL                  | preserves             | `userId`                        | case-insensitive      |
| MSSQL                  | preserves             | `userId`                        | case-insensitive      |
| ClickHouse             | none (case-sensitive) | `userId`                        | case-sensitive        |

Postgres, Redshift, Vertica, and Adobe all go through `runPostgresQuery`. The `pg` client returns whatever the engine folded to.

Quoted identifiers (`SELECT 1 AS "userId"`) preserve case on every warehouse.

ClickHouse is the only case-sensitive engine. `userId` and `userid` are distinct columns.

Within one integration, metadata-name casing matches row-key casing. `determineColumnTypes` can key the type map the same way as the row objects.

## In our control

**Snowflake post-processing.** `services/snowflake.ts` lowercases both row keys and the `columns` list after fetch, so the rest of the back-end sees `userid` rather than `USERID`. No other integration rewrites column-name case.

**Comparing configured names to warehouse names.** Default is case-insensitive (both sides folded to lowercase). ClickHouse is exact. The flag is `columnNamesAreCaseSensitive` on the integration (`true` only in `ClickHouse.ts`, default `false` on `SqlIntegration`). Helpers in `util/sql.ts` are `columnNamesMatch` and `getColumnByName`. Stored `col.column` keeps the casing we persisted. We do not fold on write.

**Generated aliases.** Experiment and metric SQL in `SqlIntegration.ts` uses GrowthBook-chosen lowercase-snake-case aliases. We control both the alias and the reader. Those paths do not depend on user column casing.
