import { format } from "shared/sql";
import type { ExperimentDiagnosticsSummaryQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { compileSqlTemplate } from "back-end/src/util/sql";

export function getExperimentDiagnosticsSummaryQuery(
  dialect: SqlDialect,
  params: ExperimentDiagnosticsSummaryQueryParams,
): string {
  const trackingKey = dialect.escapeStringLiteral(params.experimentTrackingKey);

  const compiledExposureQuery = compileSqlTemplate(
    params.exposureQuerySql,
    { startDate: params.startDate, endDate: params.endDate },
    dialect,
  );

  const baseWhere = `experiment_id = '${trackingKey}'
      AND timestamp >= ${dialect.toTimestamp(params.startDate)}
      AND timestamp < ${dialect.toTimestamp(params.endDate)}`;

  // When a dimension is selected, group by (variation_id, dimension) instead
  // of (day, variation_id) so the controller can build both dimension-level
  // and variant x dimension breakdowns from a single query.
  if (params.dimension) {
    const dimCol = dialect.castToString(params.dimension);
    return format(
      `-- Experiment Diagnostics Summary (by dimension)
      WITH __exposureQuery AS (
        ${compiledExposureQuery}
      )
      SELECT
        '' AS day,
        variation_id,
        ${dimCol} AS dimension_value,
        COUNT(*) AS exposure_count,
        COUNT(DISTINCT ${params.userIdType}) AS user_count
      FROM __exposureQuery
      WHERE ${baseWhere}
      GROUP BY variation_id, ${dimCol}
      ORDER BY variation_id, dimension_value
      `,
      dialect.formatDialect,
    );
  }

  return format(
    `-- Experiment Diagnostics Summary
    WITH __exposureQuery AS (
      ${compiledExposureQuery}
    )
    SELECT
      ${dialect.dateTrunc("timestamp", "day")} AS day,
      variation_id,
      COUNT(*) AS exposure_count,
      COUNT(DISTINCT ${params.userIdType}) AS user_count
    FROM __exposureQuery
    WHERE ${baseWhere}
    GROUP BY ${dialect.dateTrunc("timestamp", "day")}, variation_id
    ORDER BY day, variation_id
    `,
    dialect.formatDialect,
  );
}
