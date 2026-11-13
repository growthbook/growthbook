import {
  getDimensionTimestampColumns,
  getDimensionTiming,
} from "shared/experiments";
import { DimensionInterface } from "shared/types/dimension";
import type { SqlDialect } from "shared/types/sql";

// Marks a timed dimension's rows so a LEFT JOIN can tell a hit from a miss.
// ClickHouse fills a miss with type defaults rather than NULLs (epoch, '', 0),
// so neither the join key nor the timestamps can be tested for it.
export const DIMENSION_MATCHED_COLUMN = "matched";

export function getDimensionCTE(
  dimension: DimensionInterface,
  baseIdType: string,
  idJoinMap: Record<string, string>,
  dialect: SqlDialect,
): string {
  const userIdType = dimension.userIdType || "user_id";
  const timestampColumns = getDimensionTimestampColumns(
    getDimensionTiming(dimension),
  );
  const extraCols = [
    ...timestampColumns.map(
      (col) => `${dialect.castUserDateCol(`d.${col}`)} AS ${col}`,
    ),
    ...(timestampColumns.length > 0
      ? [`1 AS ${DIMENSION_MATCHED_COLUMN}`]
      : []),
  ]
    .map((col) => `,\n        ${col}`)
    .join("");

  // Need to use an identity join table
  if (userIdType !== baseIdType) {
    return `-- Dimension (${dimension.name})
      SELECT
        i.${baseIdType},
        d.value${extraCols}
      FROM
        (
          ${dimension.sql}
        ) d
        JOIN ${idJoinMap[userIdType]} i ON ( i.${userIdType} = d.${userIdType} )
      `;
  }

  if (timestampColumns.length > 0) {
    return `-- Dimension (${dimension.name})
      SELECT
        d.${userIdType},
        d.value${extraCols}
      FROM
        (
          ${dimension.sql}
        ) d
      `;
  }

  return `-- Dimension (${dimension.name})
    ${dimension.sql}
    `;
}
