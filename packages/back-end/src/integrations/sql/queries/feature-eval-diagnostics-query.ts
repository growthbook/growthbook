import { subDays } from "date-fns";
import { format } from "shared/sql";
import {
  getActiveFeatureUsageQuery,
  getFeatureUsageFeatureKeyColumn,
  getFeatureUsageIdentifierColumn,
  getFeatureUsageTimestampColumn,
  splitFeatureUsageJsonField,
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

/** Reads one field of a JSON value a warehouse returned as text or as an object. */
function readJsonField(value: unknown, field: string): unknown {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return Object.entries(parsed).find(([key]) => key === field)?.[1] ?? null;
}

/**
 * Adds `timestamp` and `feature_key` to each row from the mapped columns, since
 * the Diagnostics page reads those names, and one column per identifier type
 * that is mapped to a field inside a JSON column. Doing this in the SQL instead
 * would clash with a result column that already has the same name.
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
  const jsonIdentifiers = featureUsageQuery
    ? (featureUsageQuery.userIdTypes ?? []).flatMap((type) => {
        const parts = splitFeatureUsageJsonField(
          getFeatureUsageIdentifierColumn(featureUsageQuery, type),
        );
        return parts ? [{ type, ...parts }] : [];
      })
    : [];
  // Some warehouses change the case of returned names; Snowflake lowercases them
  const read = (row: QueryResponse["rows"][number], column: string) =>
    column in row
      ? row[column]
      : row[
          Object.keys(row).find(
            (key) => key.toLowerCase() === column.toLowerCase(),
          ) ?? column
        ];
  return rows.map((row) => ({
    ...row,
    ...Object.fromEntries(
      jsonIdentifiers.map(({ type, root, field }) => [
        type,
        readJsonField(read(row, root), field),
      ]),
    ),
    timestamp: read(row, timestampColumn),
    feature_key: read(row, featureKeyColumn),
  }));
}
