import {
  ExperimentMetricInterface,
  getColumnRefWhereClause,
  getMetricTemplateVariables,
  getUserIdTypes,
  isFactMetric,
  parseSliceMetricId,
} from "shared/experiments";
import type { PhaseSQLVar, SqlDialect } from "shared/types/sql";
import { compileSqlTemplate } from "back-end/src/util/sql";
import type { FactTableMap } from "back-end/src/models/FactTableModel";

import { getMetricColumns } from "back-end/src/integrations/sql/columns/metric-columns";
import { getMetricQueryFormat } from "back-end/src/integrations/sql/fact-metrics/metric-query-format";

export function getMetricCTE(
  dialect: SqlDialect,
  {
    metric,
    baseIdType,
    idJoinMap,
    startDate,
    endDate,
    experimentId,
    factTableMap,
    useDenominator,
    phase,
    customFields,
  }: {
    metric: ExperimentMetricInterface;
    baseIdType: string;
    idJoinMap: Record<string, string>;
    startDate: Date;
    endDate: Date | null;
    experimentId?: string;
    factTableMap: FactTableMap;
    useDenominator?: boolean;
    phase?: PhaseSQLVar;
    customFields?: Record<string, unknown>;
  },
): string {
  const cols = getMetricColumns(
    dialect,
    metric,
    factTableMap,
    "m",
    useDenominator,
  );

  // Determine the identifier column to select from
  let userIdCol = cols.userIds[baseIdType] || "user_id";
  let join = "";

  const userIdTypes = getUserIdTypes(metric, factTableMap, useDenominator);

  const isFact = isFactMetric(metric);
  const queryFormat = isFact ? "fact" : getMetricQueryFormat(metric);
  const columnRef = isFact
    ? useDenominator
      ? metric.denominator
      : metric.numerator
    : null;

  // For fact metrics with a WHERE clause
  const factTable = isFact
    ? factTableMap.get(columnRef?.factTableId || "")
    : undefined;

  if (isFact && !factTable) {
    throw new Error("Could not find fact table");
  }

  // query builder does not use a sub-query to get a the userId column to
  // equal the userIdType, so when using the query builder, continue to
  // use the actual input column name rather than the id type
  if (userIdTypes.includes(baseIdType)) {
    userIdCol = queryFormat === "builder" ? userIdCol : baseIdType;
  } else if (userIdTypes.length > 0) {
    for (let i = 0; i < userIdTypes.length; i++) {
      const userIdType: string = userIdTypes[i];
      if (userIdType in idJoinMap) {
        const metricUserIdCol =
          queryFormat === "builder"
            ? cols.userIds[userIdType]
            : `m.${userIdType}`;
        join = `JOIN ${idJoinMap[userIdType]} i ON (i.${userIdType} = ${metricUserIdCol})`;
        userIdCol = `i.${baseIdType}`;
        break;
      }
    }
  }

  const timestampDateTimeColumn = dialect.castUserDateCol(cols.timestamp);

  const schema = dialect.defaultSchema;

  const where: string[] = [];
  let sql = "";

  // From old, deprecated query builder UI
  if (queryFormat === "builder" && !isFact && metric.conditions?.length) {
    metric.conditions.forEach((c) => {
      where.push(`m.${c.column} ${c.operator} '${c.value}'`);
    });
  }

  // Add filters from the Metric
  if (isFact && factTable && columnRef) {
    const sliceInfo = parseSliceMetricId(metric.id);
    getColumnRefWhereClause({
      factTable,
      columnRef,
      escapeStringLiteral: dialect.escapeStringLiteral,
      jsonExtract: dialect.jsonExtract,
      evalBoolean: dialect.evalBoolean,
      sliceInfo,
    }).forEach((filterSQL) => {
      where.push(filterSQL);
    });

    sql = factTable.sql;
  }

  if (!isFact && queryFormat === "sql") {
    sql = metric.sql || "";
  }

  // Add date filter
  if (startDate) {
    where.push(`${cols.timestamp} >= ${dialect.toTimestamp(startDate)}`);
  }
  if (endDate) {
    where.push(`${cols.timestamp} <= ${dialect.toTimestamp(endDate)}`);
  }

  return compileSqlTemplate(
    `-- Metric (${metric.name})
      SELECT
        ${userIdCol} as ${baseIdType},
        ${cols.value} as value,
        ${timestampDateTimeColumn} as timestamp
      FROM
        ${
          queryFormat === "sql" || queryFormat === "fact"
            ? `(
              ${sql}
            )`
            : !isFact
              ? (schema && !metric.table?.match(/\./) ? schema + "." : "") +
                (metric.table || "")
              : ""
        } m
        ${join}
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    `,
    {
      startDate,
      endDate: endDate || undefined,
      experimentId,
      phase,
      customFields,
      templateVariables: getMetricTemplateVariables(
        metric,
        factTableMap,
        useDenominator,
      ),
    },
    dialect,
  );
}
