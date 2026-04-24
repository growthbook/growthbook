import type { Dimension, DimensionColumnData } from "shared/types/integrations";
import type { SqlHelpers } from "shared/types/sql";

export function getDimensionCol(
  helpers: SqlHelpers,
  dimension: Dimension,
): DimensionColumnData {
  switch (dimension.type) {
    case "experiment":
      return {
        value: `dim_exp_${dimension.id}`,
        alias: `dim_exp_${dimension.id}`,
      };
    case "user":
      return {
        value: `dim_unit_${dimension.dimension.id}`,
        alias: `dim_unit_${dimension.dimension.id}`,
      };
    case "date":
      return {
        value: `${helpers.formatDate(
          helpers.dateTrunc("first_exposure_timestamp", "day"),
        )}`,
        alias: "dim_pre_date",
      };
    case "activation":
      return {
        value: helpers.ifElse(
          `first_activation_timestamp IS NULL`,
          "'Not Activated'",
          "'Activated'",
        ),
        alias: "dim_activation",
      };
  }
}
