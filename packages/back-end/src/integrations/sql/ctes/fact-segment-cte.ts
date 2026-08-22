import {
  getFactTableIdColumnExpression,
  getFactTableTimestampColumn,
} from "shared/experiments";
import { FactTableInterface } from "shared/types/fact-table";
import type { SQLVars, SqlDialect } from "shared/types/sql";
import { compileSqlTemplate } from "back-end/src/util/sql";

/** Fact Table CTE for segments based on fact tables */
export function getFactSegmentCTE(
  dialect: SqlDialect,
  {
    factTable,
    baseIdType,
    idJoinMap,
    filters,
    sqlVars,
  }: {
    factTable: FactTableInterface;
    baseIdType: string;
    idJoinMap: Record<string, string>;
    filters?: string[];
    sqlVars?: SQLVars;
  },
): string {
  // Determine if a join is required to match up id types
  let join = "";
  let userIdCol = "";
  const userIdTypes = factTable.userIdTypes;
  // The fact table's SQL may name its identifier columns anything; each is
  // aliased back to the id type here (or joined on) so downstream SQL doesn't
  // have to know the real names.
  const idColumnOpts = {
    jsonExtract: dialect.jsonExtract,
    identifierQuote: dialect.identifierQuote,
  };
  if (userIdTypes.includes(baseIdType)) {
    userIdCol = getFactTableIdColumnExpression(
      factTable,
      baseIdType,
      idColumnOpts,
    );
  } else if (userIdTypes.length > 0) {
    for (let i = 0; i < userIdTypes.length; i++) {
      const userIdType: string = userIdTypes[i];
      if (userIdType in idJoinMap) {
        const metricUserIdCol = getFactTableIdColumnExpression(
          factTable,
          userIdType,
          { ...idColumnOpts, alias: "m" },
        );
        join = `JOIN ${idJoinMap[userIdType]} i ON (i.${userIdType} = ${metricUserIdCol})`;
        userIdCol = `i.${baseIdType}`;
        break;
      }
    }
  }

  // BQ datetime cast for SELECT statements (do not use for where)
  const timestampDateTimeColumn = dialect.castUserDateCol(
    `m.${getFactTableTimestampColumn(factTable)}`,
  );

  const sql = factTable.sql;

  const where: string[] = [];

  if (filters?.length) {
    filters.forEach((filter) => {
      const filterObj = factTable.filters.find(
        (factFilter) => factFilter.id === filter,
      );

      if (filterObj) {
        where.push(filterObj.value);
      }
    });
  }

  const baseSql = `-- Fact Table (${factTable.name})
    SELECT
      ${userIdCol} as ${baseIdType},
      ${timestampDateTimeColumn} as date
    FROM(
        ${sql}
      ) m
      ${join}
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
  `;
  return sqlVars ? compileSqlTemplate(baseSql, sqlVars, dialect) : baseSql;
}
