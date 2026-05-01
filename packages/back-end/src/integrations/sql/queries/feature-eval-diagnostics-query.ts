import { subDays } from "date-fns";
import { format } from "shared/sql";
import type { DataSourceInterface } from "shared/types/datasource";
import type { FeatureEvalDiagnosticsQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { compileSqlTemplate } from "back-end/src/util/sql";

export function getFeatureEvalDiagnosticsQuery(
  dialect: SqlDialect,
  datasource: DataSourceInterface,
  params: FeatureEvalDiagnosticsQueryParams,
): string {
  const featureKey = dialect.escapeStringLiteral(params.feature);
  const oneWeekAgo = subDays(new Date(), 7);

  const featureEvalQuery = datasource.settings?.queries?.featureUsage
    ? datasource.settings.queries.featureUsage[0].query
    : "";

  const compiledFeatureEvalQuery = compileSqlTemplate(
    featureEvalQuery,
    {
      startDate: oneWeekAgo,
    },
    dialect,
  );

  return format(
    `-- Feature Evaluation Diagnostics Query
      WITH __featureEvalQuery AS (
        ${compiledFeatureEvalQuery}
      )
      SELECT * FROM __featureEvalQuery
      WHERE feature_key = '${featureKey}' AND timestamp >= ${dialect.toTimestamp(oneWeekAgo)}
      ORDER BY timestamp DESC
      LIMIT 100
      `,
    dialect.formatDialect,
  );
}
