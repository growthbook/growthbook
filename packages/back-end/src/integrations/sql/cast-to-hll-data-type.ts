import { SqlHelpers } from "shared/types/sql";

export function castToHllDataType(helpers: SqlHelpers, col: string): string {
  return `CAST(${col} AS ${helpers.getDataType("hll")})`;
}
