import { NULL_DIMENSION_VALUE } from "shared/constants";
import {
  Dimension,
  ExperimentDimension,
  UserDimension,
} from "shared/types/integrations";
import type { SqlHelpers } from "shared/types/sql";

export function getDimensionValuePerUnit(
  helpers: SqlHelpers,
  dimension: UserDimension | ExperimentDimension | null,
  experimentDimensionPrefix?: string,
): string {
  if (!dimension) {
    return helpers.castToString("''");
  }
  if (dimension.type === "user") {
    return `COALESCE(MAX(${helpers.castToString(
      `__dim_unit_${dimension.dimension.id}.value`,
    )}),'${NULL_DIMENSION_VALUE}')`;
  }
  if (dimension.type === "experiment") {
    return `SUBSTRING(
        MIN(
          CONCAT(SUBSTRING(${helpers.castToString("e.timestamp")}, 1, 19),
            coalesce(${helpers.castToString(
              `e.${experimentDimensionPrefix ?? "dim_"}${dimension.id}`,
            )}, ${helpers.castToString(`'${NULL_DIMENSION_VALUE}'`)})
          )
        ),
        20,
        99999
      )`;
  }

  throw new Error("Unknown dimension type: " + (dimension as Dimension).type);
}
