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

  // Dropping an unusable identifier would return unfiltered rows while the UI
  // still shows the filter as applied, so refuse the query instead. The
  // controller turns this into a visible error.
  const assertSafeIdentifier = (name: string, label: string) => {
    if (!isSafeIdentifier(name)) {
      throw new Error(
        `${label} "${name}" is not a supported column name for exposure logs.`,
      );
    }
  };

  params.dimensions.forEach((d) => assertSafeIdentifier(d, "Dimension"));

  // Ordering on every configured column keeps paging stable for rows that tie
  // on timestamp. Rows identical across all of them can still swap places
  // between pages — the exposure query has no unique key to break that tie.
  const orderColumns = Array.from(
    new Set([
      "timestamp",
      params.userIdType,
      "variation_id",
      ...params.dimensions,
    ]),
  );
  orderColumns.forEach((c) => assertSafeIdentifier(c, "Column"));

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
      if (!val) continue;
      if (!params.dimensions.includes(dim)) {
        throw new Error(
          `Dimension "${dim}" is not available on this exposure query.`,
        );
      }
      extraConditions.push(`${dim} = '${dialect.escapeStringLiteral(val)}'`);
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
    ${dialect.paginate(limit, offset)}
    `,
    dialect.formatDialect,
  );
}
