import { SqlDialect } from "shared/types/sql";

export function castToHllDataType(dialect: SqlDialect, col: string): string {
  return `CAST(${col} AS ${dialect.getDataType("hll")})`;
}
