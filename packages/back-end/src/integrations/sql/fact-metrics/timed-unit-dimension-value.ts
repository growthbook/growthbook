import { NULL_DIMENSION_VALUE } from "shared/constants";
import {
  DIMENSION_END_TIMESTAMP_COLUMN,
  DIMENSION_START_TIMESTAMP_COLUMN,
  DIMENSION_TIMESTAMP_COLUMN,
  getDimensionNullValue,
  getDimensionTiming,
} from "shared/experiments";
import type { DimensionInterface } from "shared/types/dimension";
import type { SqlDialect } from "shared/types/sql";
import { concatSql } from "back-end/src/integrations/sql/primitives/concat";

// Time checks live inside the aggregate (not the join) so the dimension join
// stays an equi-join on every warehouse and units with no qualifying row are kept.
// `exposure` must have the same type as the dimension's castUserDateCol'd
// timestamp columns (callers reading a stored units table cast it first).
export function getTimedUnitDimensionCondition(
  dimension: DimensionInterface,
  exposure: string,
  dimAlias: string,
): string {
  switch (getDimensionTiming(dimension)) {
    case "rowTimestamp":
      return `${dimAlias}.${DIMENSION_TIMESTAMP_COLUMN} <= ${exposure}`;
    case "validityRange":
      return `${dimAlias}.${DIMENSION_START_TIMESTAMP_COLUMN} <= ${exposure} AND (${dimAlias}.${DIMENSION_END_TIMESTAMP_COLUMN} IS NULL OR ${exposure} < ${dimAlias}.${DIMENSION_END_TIMESTAMP_COLUMN})`;
    case "none":
      throw new Error(
        `Dimension ${dimension.id} has no time-aware timing setting`,
      );
  }
}

// Latest qualifying row wins: prefix each value with its formatted timestamp,
// take the MAX, then strip the 19-char prefix (same trick as experiment dimensions).
export function getTimedUnitDimensionValue(
  dialect: SqlDialect,
  dimension: DimensionInterface,
  exposure: string,
  dimAlias: string,
): string {
  const timestampColumn =
    getDimensionTiming(dimension) === "validityRange"
      ? DIMENSION_START_TIMESTAMP_COLUMN
      : DIMENSION_TIMESTAMP_COLUMN;
  const nullValue = `'${dialect.escapeStringLiteral(
    getDimensionNullValue(dimension, NULL_DIMENSION_VALUE),
  )}'`;
  const keyed = concatSql(
    `SUBSTRING(${dialect.formatDateTimeString(`${dimAlias}.${timestampColumn}`)}, 1, 19)`,
    `COALESCE(${dialect.castToString(`${dimAlias}.value`)}, ${nullValue})`,
  );
  return `COALESCE(
        SUBSTRING(
          MAX(
            ${dialect.ifElse(
              getTimedUnitDimensionCondition(dimension, exposure, dimAlias),
              keyed,
              "NULL",
            )}
          ),
          20,
          99999
        ),
        ${nullValue}
      )`;
}
