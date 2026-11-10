import { subDays } from "date-fns";
import { format } from "shared/sql";
import {
  getActiveFeatureUsageQuery,
  getFeatureUsageFeatureKeyColumn,
  getFeatureUsageTimestampColumn,
} from "shared/util";
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

  const featureUsageQuery = getActiveFeatureUsageQuery(
    datasource.settings?.queries?.featureUsage,
  );
  const featureEvalQuery = featureUsageQuery?.query ?? "";
  // Mapped names are checked on save to need no quoting, like assignment queries
  const featureKeyColumn = featureUsageQuery
    ? getFeatureUsageFeatureKeyColumn(featureUsageQuery)
    : "feature_key";
  const timestampColumn = featureUsageQuery
    ? getFeatureUsageTimestampColumn(featureUsageQuery)
    : "timestamp";

  // Rows are read by the standard names, so return renamed columns under them too
  const standardNameAliases = [
    [timestampColumn, "timestamp"],
    [featureKeyColumn, "feature_key"],
  ]
    .filter(([column, name]) => column !== name)
    .map(([column, name]) => `, ${column} AS ${name}`)
    .join("");

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
      SELECT *${standardNameAliases} FROM __featureEvalQuery
      WHERE ${featureKeyColumn} = '${featureKey}' AND ${timestampColumn} >= ${dialect.toTimestamp(oneWeekAgo)}
      ORDER BY ${timestampColumn} DESC
      LIMIT 100
      `,
    dialect.formatDialect,
  );
}
