import { format } from "shared/sql";
import type { ExperimentDiagnosticsRecordsQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { compileSqlTemplate } from "back-end/src/util/sql";

export function getExperimentDiagnosticsRecordsQuery(
  dialect: SqlDialect,
  params: ExperimentDiagnosticsRecordsQueryParams,
): string {
  const trackingKey = dialect.escapeStringLiteral(params.experimentTrackingKey);

  const compiledExposureQuery = compileSqlTemplate(
    params.exposureQuerySql,
    { startDate: params.startDate, endDate: params.endDate },
    dialect,
  );

  const limit = Math.max(1, Math.min(100, Math.floor(params.limit)));
  const offset = Math.max(0, Math.floor(params.offset));

  const dimensionCols = params.dimensions.length
    ? ", " +
      params.dimensions
        .map((d) => `${dialect.castToString(`${d}`)} AS ${d}`)
        .join(", ")
    : "";

  const extraConditions: string[] = [];
  if (params.userId) {
    extraConditions.push(
      `${params.userIdType} = '${dialect.escapeStringLiteral(params.userId)}'`,
    );
  }
  if (params.variationId) {
    extraConditions.push(
      `variation_id = '${dialect.escapeStringLiteral(params.variationId)}'`,
    );
  }
  if (params.dimensionFilters) {
    for (const [dim, val] of Object.entries(params.dimensionFilters)) {
      if (val && params.dimensions.includes(dim)) {
        extraConditions.push(`${dim} = '${dialect.escapeStringLiteral(val)}'`);
      }
    }
  }
  const extraWhere = extraConditions.length
    ? " AND " + extraConditions.join(" AND ")
    : "";

  return format(
    `-- Experiment Diagnostics Records
    WITH __exposureQuery AS (
      ${compiledExposureQuery}
    )
    SELECT
      timestamp,
      ${params.userIdType} AS user_id,
      variation_id${dimensionCols}
    FROM __exposureQuery
    WHERE experiment_id = '${trackingKey}'
      AND timestamp >= ${dialect.toTimestamp(params.startDate)}
      AND timestamp < ${dialect.toTimestamp(params.endDate)}${extraWhere}
    ORDER BY timestamp DESC
    LIMIT ${limit} OFFSET ${offset}
    `,
    dialect.formatDialect,
  );
}
