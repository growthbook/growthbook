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

// 'YYYY-MM-DD HH:MM:SS'
const TIMESTAMP_PREFIX_LENGTH = 19;

// Fixed-width sortable prefix. A DATE column formats shorter than a timestamp
// on some engines (10 chars from to_iso8601 on Athena/Presto), so pad before
// cutting; otherwise stripping the prefix would eat into the dimension value.
// Zeros rather than spaces so whitespace normalization can't shrink the pad.
function getTimestampPrefix(dialect: SqlDialect, column: string): string {
  const padded = concatSql(
    dialect.formatDateTimeString(column),
    `'${"0".repeat(TIMESTAMP_PREFIX_LENGTH)}'`,
  );
  return `SUBSTRING(${padded}, 1, ${TIMESTAMP_PREFIX_LENGTH})`;
}

// Latest qualifying row wins: prefix each value with its formatted timestamp,
// take the MAX, then strip the prefix (same trick as experiment dimensions).
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
    getTimestampPrefix(dialect, `${dimAlias}.${timestampColumn}`),
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
          ${TIMESTAMP_PREFIX_LENGTH + 1},
          99999
        ),
        ${nullValue}
      )`;
}
