import { NULL_DIMENSION_VALUE } from "shared/constants";
import type { Dimension, DimensionColumnData } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { concatSql } from "back-end/src/integrations/sql/primitives/concat";

export function getDimensionCol(
  dialect: SqlDialect,
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
        value: `${dialect.formatDate(
          dialect.dateTrunc("first_exposure_timestamp", "day"),
        )}`,
        alias: "dim_pre_date",
      };
    case "activation":
      return {
        value: dialect.ifElse(
          `first_activation_timestamp IS NULL`,
          "'Not Activated'",
          "'Activated'",
        ),
        alias: "dim_activation",
      };
    case "datecutoff": {
      // Minute-precision UTC label; the full ISO string lives in the dimension id
      const label = dimension.cutoff.toISOString().substring(0, 16) + "Z";
      return {
        value: dialect.ifElse(
          `first_exposure_timestamp < ${dialect.toTimestamp(dimension.cutoff)}`,
          `'Before ${label}'`,
          `'After ${label}'`,
        ),
        alias: "dim_cutoff",
      };
    }
    // The alias must not start with "dim_exp_", which gbstats treats as
    // post-stratification strata columns
    case "combo": {
      const parts: string[] = [];
      for (const constituent of dimension.dimensions) {
        if (parts.length) parts.push(`' & '`);
        const name =
          constituent.type === "experiment"
            ? constituent.id
            : constituent.dimension.name;
        // COALESCE per constituent: CONCAT NULL-poisons on some engines
        const col = `COALESCE(${dialect.castToString(
          getDimensionCol(dialect, constituent).alias,
        )}, '${NULL_DIMENSION_VALUE}')`;
        parts.push(`'${dialect.escapeStringLiteral(name)}: '`, col);
      }
      return {
        value: concatSql(...parts),
        alias: "dim_combo",
      };
    }
  }
}
