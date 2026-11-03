import { NULL_VARIATION_VALUE } from "shared/constants";
import type { SqlDialect } from "shared/types/sql";
import { concatSql } from "back-end/src/integrations/sql/primitives/concat";

export function getFirstVariationValuePerUnit(dialect: SqlDialect): string {
  return `SUBSTRING(
        MIN(
          ${concatSql(
            `SUBSTRING(${dialect.formatDateTimeString("e.timestamp")}, 1, 19)`,
            `coalesce(${dialect.castToString(
              `e.variation`,
            )}, ${dialect.castToString(`'${NULL_VARIATION_VALUE}'`)})`,
          )}
        ),
        20,
        99999
      )`;
}
