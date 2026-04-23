import { NULL_VARIATION_VALUE } from "shared/constants";
import type { SqlHelpers } from "shared/types/sql";

export function getFirstVariationValuePerUnit(helpers: SqlHelpers): string {
  return `SUBSTRING(
        MIN(
          CONCAT(SUBSTRING(${helpers.castToString("e.timestamp")}, 1, 19),
            coalesce(${helpers.castToString(
              `e.variation`,
            )}, ${helpers.castToString(`'${NULL_VARIATION_VALUE}'`)})
          )
        ),
        20,
        99999
      )`;
}
