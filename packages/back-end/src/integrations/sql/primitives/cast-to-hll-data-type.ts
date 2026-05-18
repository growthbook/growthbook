import { SqlDialect } from "shared/types/sql";

export function castToHllDataType(dialect: SqlDialect, col: string): string {
  // ClickHouse: `uniqState` already yields an AggregateFunction column. Casting
  // to VARBINARY (the generic dialect type) becomes String in practice and
  // breaks `-Merge`/`-MergeState` combinators (they require AggregateFunction).
  if (dialect.formatDialect === "clickhouse") {
    return col;
  }
  return `CAST(${col} AS ${dialect.getDataType("hll")})`;
}
