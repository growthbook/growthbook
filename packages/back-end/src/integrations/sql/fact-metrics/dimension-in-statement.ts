import { AUTOMATIC_DIMENSION_OTHER_NAME } from "shared/constants";
import { SqlDialect } from "shared/types/sql";

export function getDimensionInStatement(
  dialect: SqlDialect,
  dimension: string,
  values: string[],
): string {
  return dialect.ifElse(
    `${dialect.castToString(dimension)} IN (${values
      .map((v) => `'` + dialect.escapeStringLiteral(v) + `'`)
      .join(",")})`,
    dialect.castToString(dimension),
    dialect.castToString(`'${AUTOMATIC_DIMENSION_OTHER_NAME}'`),
  );
}
