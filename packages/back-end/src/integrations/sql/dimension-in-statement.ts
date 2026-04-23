import { AUTOMATIC_DIMENSION_OTHER_NAME } from "shared/constants";
import { SqlHelpers } from "shared/types/sql";

export function getDimensionInStatement(
  helpers: SqlHelpers,
  dimension: string,
  values: string[],
): string {
  return helpers.ifElse(
    `${helpers.castToString(dimension)} IN (${values
      .map((v) => `'` + helpers.escapeStringLiteral(v) + `'`)
      .join(",")})`,
    helpers.castToString(dimension),
    helpers.castToString(`'${AUTOMATIC_DIMENSION_OTHER_NAME}'`),
  );
}
