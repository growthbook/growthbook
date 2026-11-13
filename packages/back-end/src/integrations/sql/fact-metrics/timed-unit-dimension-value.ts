import { NULL_DIMENSION_VALUE } from "shared/constants";
import {
  DIMENSION_END_TIMESTAMP_COLUMN,
  DIMENSION_START_TIMESTAMP_COLUMN,
  DIMENSION_TIMESTAMP_COLUMN,
  getDimensionNullValue,
  getDimensionTiming,
  isTimedDimension,
} from "shared/experiments";
import type { DimensionInterface } from "shared/types/dimension";
import type { UserDimension } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { getDimensionCol } from "back-end/src/integrations/sql/columns/dimension-col";
import { getDimensionValuePerUnit } from "back-end/src/integrations/sql/fact-metrics/dimension-value-per-unit";
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

// A dimension keyed on a cluster experiment's cluster is the cluster's, so
// every sub-unit resolves it at the cluster's first exposure and a cluster
// never splits across values. Wraps a one-row-per-sub-unit source to add it.
const CLUSTER_FIRST_EXPOSURE_COLUMN = "cluster_first_exposure_timestamp";
function withClusterFirstExposure(
  source: string,
  clusterColumn: string,
): string {
  return `(
        SELECT
          u.*
          , MIN(u.first_exposure_timestamp) OVER (PARTITION BY u.${clusterColumn}) AS ${CLUSTER_FIRST_EXPOSURE_COLUMN}
        FROM ${source} u
      )`;
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

// Resolves unit dimensions one at a time in a chain of CTEs with one row per
// `rowIdType`. Each step reads the previous CTE once and joins one dimension,
// so N histories cost |h1| + ... + |hN| rows per unit rather than their
// product, and no CTE is referenced twice (BigQuery may re-evaluate those).
export function getUnitDimensionChain(
  dialect: SqlDialect,
  {
    dimensions,
    getJoinIdType,
    sourceCte,
    cteName,
    stepPrefix,
    rowIdType,
    carriedColumns,
    stringIds,
    castExposure,
  }: {
    dimensions: UserDimension[];
    getJoinIdType: (d: UserDimension) => string;
    sourceCte: string;
    // The last step; earlier ones are `${stepPrefix}1`, `${stepPrefix}2`, ...
    cteName: string;
    stepPrefix: string;
    rowIdType: string;
    // Every column of `sourceCte`, `rowIdType` included
    carriedColumns: string[];
    // `sourceCte` stores every id as a string, so dimension keys are cast to
    // match. A cluster key is always stored as one.
    stringIds: boolean;
    // `sourceCte` stores first_exposure_timestamp as a native TIMESTAMP, which
    // must match the dimension CTE's castUserDateCol'd columns
    castExposure: boolean;
  },
): { sql: string; cteName: string } {
  const aliases = dimensions.map((d) => getDimensionCol(dialect, d).alias);
  return {
    cteName: dimensions.length > 0 ? cteName : sourceCte,
    sql: dimensions
      .map((d, i) => {
        const dimCte = `__dim_unit_${d.dimension.id}`;
        const joinIdType = getJoinIdType(d);
        const timed = isTimedDimension(d.dimension);
        // keyed on the cluster while the rows are its sub-units
        const isClusterKeyed = joinIdType !== rowIdType;
        const exposure = isClusterKeyed
          ? `u.${CLUSTER_FIRST_EXPOSURE_COLUMN}`
          : "u.first_exposure_timestamp";
        const prevCte = i === 0 ? sourceCte : `${stepPrefix}${i}`;
        const key = `${dimCte}.${joinIdType}`;
        const carried = [...carriedColumns, ...aliases.slice(0, i)].map(
          (alias) => `u.${alias}`,
        );
        return `, ${i === dimensions.length - 1 ? cteName : `${stepPrefix}${i + 1}`} AS (
      -- Resolve ${d.dimension.name}${timed ? " against each unit's first exposure" : ""}
      SELECT
        ${carried.join("\n        , ")}
        , ${
          timed
            ? getTimedUnitDimensionValue(
                dialect,
                d.dimension,
                castExposure ? dialect.castUserDateCol(exposure) : exposure,
                dimCte,
              )
            : getDimensionValuePerUnit(dialect, d)
        } AS ${aliases[i]}
      FROM ${timed && isClusterKeyed ? withClusterFirstExposure(prevCte, joinIdType) : prevCte} u
      LEFT JOIN ${dimCte} ${dimCte} ON (
        ${stringIds || isClusterKeyed ? dialect.castToString(key) : key} = u.${joinIdType}
      )
      GROUP BY
        ${carried.join(", ")}
    )`;
      })
      .join("\n"),
  };
}
