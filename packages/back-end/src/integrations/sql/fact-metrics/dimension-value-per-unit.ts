import { NULL_DIMENSION_VALUE } from "shared/constants";
import {
  Dimension,
  ExperimentDimension,
  UserDimension,
} from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";

export function getDimensionValuePerUnit(
  dialect: SqlDialect,
  dimension: UserDimension | ExperimentDimension | null,
  experimentDimensionPrefix?: string,
): string {
  if (!dimension) {
    return dialect.castToString("''");
  }
  if (dimension.type === "user") {
    return `COALESCE(MAX(${dialect.castToString(
      `__dim_unit_${dimension.dimension.id}.value`,
    )}),'${NULL_DIMENSION_VALUE}')`;
  }
  if (dimension.type === "experiment") {
    return `SUBSTRING(
        MIN(
          CONCAT(SUBSTRING(${dialect.formatDateTimeString("e.timestamp")}, 1, 19),
            coalesce(${dialect.castToString(
              `e.${experimentDimensionPrefix ?? "dim_"}${dimension.id}`,
            )}, ${dialect.castToString(`'${NULL_DIMENSION_VALUE}'`)})
          )
        ),
        20,
        99999
      )`;
  }

  throw new Error("Unknown dimension type: " + (dimension as Dimension).type);
}
