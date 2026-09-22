import { format } from "shared/sql";
import { getActiveFeatureUsageQuery } from "shared/util";
import type { DataSourceInterface } from "shared/types/datasource";
import type { FeatureEvalDiagnosticsQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { compileSqlTemplate } from "back-end/src/util/sql";
import { resolveFeatureEvalDiagnosticsWindow } from "back-end/src/integrations/sql/queries/feature-eval-diagnostics-window";

export function getFeatureEvalDiagnosticsQuery(
  dialect: SqlDialect,
  datasource: DataSourceInterface,
  params: FeatureEvalDiagnosticsQueryParams,
): string {
  const featureKey = dialect.escapeStringLiteral(params.feature);
  const { start, limit } = resolveFeatureEvalDiagnosticsWindow(params);

  const featureUsageQuery = getActiveFeatureUsageQuery(
    datasource.settings?.queries?.featureUsage,
  );
  const featureEvalQuery = featureUsageQuery?.query ?? "";

  const compiledFeatureEvalQuery = compileSqlTemplate(
    featureEvalQuery,
    {
      startDate: start,
    },
    dialect,
  );

  return format(
    `-- Feature Evaluation Diagnostics Query
      WITH __featureEvalQuery AS (
        ${compiledFeatureEvalQuery}
      )
      SELECT * FROM __featureEvalQuery
      WHERE feature_key = '${featureKey}' AND timestamp >= ${dialect.toTimestamp(start)}
      ORDER BY timestamp DESC
      LIMIT ${limit}
      `,
    dialect.formatDialect,
  );
}
