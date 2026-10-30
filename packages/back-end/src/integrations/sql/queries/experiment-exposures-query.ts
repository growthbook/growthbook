import { format, quoteIdentifier, SQL_ROW_LIMIT } from "shared/sql";
import { buildRowFilterWhereClause } from "shared/experiments";
import { stringRowFilterOperators } from "shared/validators";
import {
  getExposureQueryExperimentIdColumn,
  getExposureQueryIdentifierColumn,
  getExposureQueryTimestampColumn,
  getExposureQueryVariationIdColumn,
} from "shared/util";
import type { FactTableInterface, RowFilter } from "shared/types/fact-table";
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

function filterColumnExpr(column: string, dialect: SqlDialect): string {
  const cast = dialect.castToFilterString ?? dialect.castToString;
  return dialect.lowerString(cast(quoteColumnIdentifier(column, dialect)));
}

function quoteColumnIdentifier(name: string, dialect: SqlDialect): string {
  const folded =
    dialect.unquotedIdentifierFold === "upper"
      ? name.toUpperCase()
      : dialect.unquotedIdentifierFold === "lower"
        ? name.toLowerCase()
        : name;
  return quoteIdentifier(folded, dialect.identifierQuote);
}

function exposureColumnsAsFactTable(
  columns: string[],
  dialect: SqlDialect,
): Pick<FactTableInterface, "columns" | "filters" | "userIdTypes"> {
  return {
    filters: [],
    userIdTypes: [],
    columns: columns.map((column) => ({
      column,
      name: column,
      datatype: "string" as const,
      isVirtual: true,
      sql: filterColumnExpr(column, dialect),
      description: "",
      numberFormat: "" as const,
      deleted: false,
      dateCreated: new Date(0),
      dateUpdated: new Date(0),
    })),
  };
}

function isStringRowFilterOperator(
  operator: RowFilter["operator"],
): operator is (typeof stringRowFilterOperators)[number] {
  return (stringRowFilterOperators as readonly string[]).includes(operator);
}

export function getExperimentExposuresQuery(
  dialect: SqlDialect,
  params: ExperimentExposuresQueryParams,
): string {
  const trackingKey = dialect.escapeStringLiteral(params.experimentTrackingKey);

  const compiledExposureQuery = compileSqlTemplate(
    params.exposureQuery.query,
    {
      startDate: params.startDate,
      endDate: params.endDate,
      experimentId: params.experimentTrackingKey,
      phase: params.phase,
      customFields: params.customFields,
    },
    dialect,
  );

  // One extra row so the caller can report the buffer as truncated.
  const limit =
    Math.max(1, Math.min(SQL_ROW_LIMIT, Math.floor(params.limit))) + 1;

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

  const { exposureQuery } = params;
  const timestampColumn = getExposureQueryTimestampColumn(exposureQuery);
  const experimentIdColumn = getExposureQueryExperimentIdColumn(exposureQuery);
  // Filters name roles canonically, but the query returns the mapped columns
  const physicalColumns: Record<string, string> = {
    timestamp: timestampColumn,
    variation_id: getExposureQueryVariationIdColumn(exposureQuery),
    [exposureQuery.identifierType]: getExposureQueryIdentifierColumn(
      exposureQuery,
      exposureQuery.identifierType,
    ),
  };
  const toPhysical = (column: string) => physicalColumns[column] ?? column;

  // Ordering on every configured column keeps paging stable for rows that tie
  // on timestamp. Rows identical across all of them can still swap places
  // between pages — the exposure query has no unique key to break that tie.
  const filterableColumns = Array.from(
    new Set([
      "timestamp",
      exposureQuery.identifierType,
      "variation_id",
      ...params.dimensions,
    ]),
  );
  const orderColumns = Array.from(new Set(filterableColumns.map(toPhysical)));
  [...orderColumns, experimentIdColumn].forEach((c) =>
    assertSafeIdentifier(c, "Column"),
  );

  const rowFilters = params.rowFilters ?? [];
  rowFilters.forEach((f) => {
    if (!isStringRowFilterOperator(f.operator)) {
      throw new Error(
        `Filter operator "${f.operator}" is not supported for exposure logs.`,
      );
    }
    if (!f.column || !filterableColumns.includes(f.column)) {
      throw new Error(
        `Column "${f.column ?? ""}" is not available on this exposure query.`,
      );
    }
  });
  const rowFilterWhere = rowFilters.length
    ? buildRowFilterWhereClause({
        rowFilters: rowFilters.map((f) => ({
          ...f,
          column: toPhysical(f.column ?? ""),
          values: f.values?.map((v) => v.toLowerCase()),
        })),
        factTable: exposureColumnsAsFactTable(orderColumns, dialect),
        dialect,
      })
    : "";
  const extraWhere = rowFilterWhere
    ? `
      AND ${rowFilterWhere}`
    : "";

  const whereAndOrderBy = `WHERE ${quoteColumnIdentifier(experimentIdColumn, dialect)} = '${trackingKey}'
      AND ${quoteColumnIdentifier(timestampColumn, dialect)} >= ${dialect.toTimestamp(params.startDate)}
      AND ${quoteColumnIdentifier(timestampColumn, dialect)} < ${dialect.toTimestamp(params.endDate)}${extraWhere}
    ORDER BY ${orderColumns.map((column) => `${quoteColumnIdentifier(column, dialect)} DESC`).join(", ")}`;

  // SELECT * rather than an explicit column list: every column the exposure
  // query returns is surfaced behind the expandable row, and aliasing would
  // reintroduce the identifier-folding mismatch described in
  // .agents/guides/backend/warehouse-column-casing.md
  return format(
    `-- Experiment Exposures
    WITH __exposureQuery AS (
      ${compiledExposureQuery}
    )
    ${dialect.selectStarLimit("__exposureQuery", limit, whereAndOrderBy)}
    `,
    dialect.formatDialect,
  );
}
