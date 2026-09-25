import { format } from "shared/sql";
import type { ExperimentExposuresQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { compileSqlTemplate } from "back-end/src/util/sql";

// Dimension names come from datasource settings and are interpolated as raw
// identifiers. Their editors can already supply arbitrary SQL through the
// exposure query itself, so this is not an escalation, but reject anything
// that isn't identifier-shaped rather than emitting broken SQL.
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isSafeIdentifier(name: string): boolean {
  return SAFE_IDENTIFIER.test(name);
}

export function getExperimentExposuresQuery(
  dialect: SqlDialect,
  params: ExperimentExposuresQueryParams,
): string {
  const trackingKey = dialect.escapeStringLiteral(params.experimentTrackingKey);

  const compiledExposureQuery = compileSqlTemplate(
    params.exposureQuerySql,
    {
      startDate: params.startDate,
      endDate: params.endDate,
      experimentId: params.experimentTrackingKey,
    },
    dialect,
  );

  // Fetch one extra row to tell the client whether another page exists.
  const limit = Math.max(1, Math.min(101, Math.floor(params.limit) + 1));
  const offset = Math.max(0, Math.floor(params.offset));

  const safeDimensions = params.dimensions.filter(isSafeIdentifier);
  const orderColumns = Array.from(
    new Set([
      "timestamp",
      ...(isSafeIdentifier(params.userIdType) ? [params.userIdType] : []),
      "variation_id",
      ...safeDimensions,
    ]),
  );

  const extraConditions: string[] = [];
  if (params.userId && isSafeIdentifier(params.userIdType)) {
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
      if (val && safeDimensions.includes(dim)) {
        extraConditions.push(`${dim} = '${dialect.escapeStringLiteral(val)}'`);
      }
    }
  }
  const extraWhere = extraConditions.length
    ? " AND " + extraConditions.join(" AND ")
    : "";

  // SELECT * rather than an explicit column list: every column the exposure
  // query returns is surfaced behind the expandable row, and aliasing would
  // reintroduce the identifier-folding mismatch described in
  // .agents/guides/backend/warehouse-column-casing.md
  return format(
    `-- Experiment Exposures
    WITH __exposureQuery AS (
      ${compiledExposureQuery}
    )
    SELECT * FROM __exposureQuery
    WHERE experiment_id = '${trackingKey}'
      AND timestamp >= ${dialect.toTimestamp(params.startDate)}
      AND timestamp < ${dialect.toTimestamp(params.endDate)}${extraWhere}
    ORDER BY ${orderColumns.map((column) => `${column} DESC`).join(", ")}
    LIMIT ${limit} OFFSET ${offset}
    `,
    dialect.formatDialect,
  );
}
