import { SegmentInterface } from "shared/types/segment";
import type { SQLVars, SqlDialect } from "shared/types/sql";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { compileSqlTemplate } from "back-end/src/util/sql";

import { getFactSegmentCTE } from "back-end/src/integrations/sql/ctes/fact-segment-cte";

export function getSegmentCTE(
  dialect: SqlDialect,
  segment: SegmentInterface,
  baseIdType: string,
  idJoinMap: Record<string, string>,
  factTableMap: FactTableMap,
  sqlVars?: SQLVars,
): string {
  // replace template variables
  let segmentSql = "";

  if (segment.type === "SQL") {
    if (!segment.sql) {
      throw new Error(
        `Segment ${segment.name} is a SQL Segment but has no SQL value`,
      );
    }
    segmentSql = sqlVars
      ? compileSqlTemplate(segment.sql, sqlVars, dialect)
      : segment.sql;
  } else {
    if (!segment.factTableId) {
      throw new Error(
        `Segment ${segment.name} is a FACT Segment, but has no factTableId set`,
      );
    }
    const factTable = factTableMap.get(segment.factTableId);

    if (!factTable) {
      throw new Error(`Unknown fact table: ${segment.factTableId}`);
    }

    segmentSql = getFactSegmentCTE(dialect, {
      baseIdType,
      idJoinMap,
      factTable,
      filters: segment.filters,
      sqlVars,
    });

    return `-- Segment (${segment.name})
        SELECT * FROM (\n${segmentSql}\n) s `;
  }

  const dateCol = dialect.castUserDateCol("s.date");

  const userIdType = segment.userIdType || "user_id";

  // Need to use an identity join table
  if (userIdType !== baseIdType) {
    return `-- Segment (${segment.name})
      SELECT
        i.${baseIdType},
        ${dateCol} as date
      FROM
        (
          ${segmentSql}
        ) s
        JOIN ${idJoinMap[userIdType]} i ON ( i.${userIdType} = s.${userIdType} )
      `;
  }

  if (dateCol !== "s.date") {
    return `-- Segment (${segment.name})
      SELECT
        s.${userIdType},
        ${dateCol} as date
      FROM
        (
          ${segmentSql}
        ) s`;
  }
  return `-- Segment (${segment.name})
    ${segmentSql}
    `;
}
