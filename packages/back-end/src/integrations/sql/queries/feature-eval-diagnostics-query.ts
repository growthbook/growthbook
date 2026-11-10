import { subDays } from "date-fns";
import { format } from "shared/sql";
import {
  getActiveFeatureUsageQuery,
  getFeatureUsageFeatureKeyColumn,
  getFeatureUsageTimestampColumn,
} from "shared/util";
import type {
  DataSourceInterface,
  FeatureUsageQuery,
} from "shared/types/datasource";
import type {
  FeatureEvalDiagnosticsQueryParams,
  FeatureEvalDiagnosticsQueryResponseRows,
  QueryResponse,
} from "shared/types/integrations";
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
      WHERE ${featureKeyColumn} = '${featureKey}' AND ${timestampColumn} >= ${dialect.toTimestamp(oneWeekAgo)}
      ORDER BY ${timestampColumn} DESC
      LIMIT 100
      `,
    dialect.formatDialect,
  );
}

/**
 * Adds `timestamp` and `feature_key` to each row from the mapped columns, since
 * the Diagnostics page reads those names. Renaming them in the SQL instead would
 * clash with a result column that already has the standard name.
 */
export function shapeFeatureEvalDiagnosticsRows(
  rows: QueryResponse["rows"],
  featureUsageQuery: FeatureUsageQuery | undefined,
): FeatureEvalDiagnosticsQueryResponseRows {
  const timestampColumn = featureUsageQuery
    ? getFeatureUsageTimestampColumn(featureUsageQuery)
    : "timestamp";
  const featureKeyColumn = featureUsageQuery
    ? getFeatureUsageFeatureKeyColumn(featureUsageQuery)
    : "feature_key";
  return rows.map((row) => ({
    ...row,
    timestamp: row[timestampColumn],
    feature_key: row[featureKeyColumn],
  }));
}
