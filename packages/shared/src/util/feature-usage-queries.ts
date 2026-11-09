import type {
  FeatureUsageQuery,
  FeatureUsageQueryColumnMapping,
} from "shared/types/datasource";
import type { SqlDialect, UnquotedIdentifierFold } from "shared/types/sql";
import { findMappedColumnsNeedingQuotes } from "./exposure-queries";

type WithColumnMapping = { columnMapping?: FeatureUsageQueryColumnMapping };
type WithColumns = Pick<FeatureUsageQuery, "columns">;

const PLAIN_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * An identifier column can be a field inside a JSON column, written
 * `root.field`, like fact tables. Only one level is supported for now.
 */
export function splitFeatureUsageJsonField(
  column: string,
): { root: string; field: string } | null {
  const [root, field, ...rest] = column.split(".");
  return field !== undefined && !rest.length ? { root, field } : null;
}

const isJsonColumn = (query: WithColumns, column: string) =>
  !!query.columns?.some((c) => c.column === column && c.datatype === "json");

/** The column a mapped identifier reads from: the JSON column for a field. */
const getRootColumn = (column: string) =>
  column.includes(".") ? column.split(".")[0] : column;

// An unset mapping falls back to the standard name, so SQL that aliases its
// columns to those names needs no mapping.
export function getFeatureUsageTimestampColumn(
  query: WithColumnMapping,
): string {
  return query.columnMapping?.timestampColumn || "timestamp";
}

export function getFeatureUsageFeatureKeyColumn(
  query: WithColumnMapping,
): string {
  return query.columnMapping?.featureKeyColumn || "feature_key";
}

export function getFeatureUsageEnvironmentColumn(
  query: WithColumnMapping,
): string {
  return query.columnMapping?.environmentColumn || "environment";
}

export function getFeatureUsageValueColumn(query: WithColumnMapping): string {
  return query.columnMapping?.valueColumn || "value";
}

export function getFeatureUsageRuleIdColumn(query: WithColumnMapping): string {
  return query.columnMapping?.ruleIdColumn || "rule_id";
}

export function getFeatureUsageVariationIdColumn(
  query: WithColumnMapping,
): string {
  return query.columnMapping?.variationIdColumn || "variation_id";
}

export function getFeatureUsageSourceColumn(query: WithColumnMapping): string {
  return query.columnMapping?.sourceColumn || "source";
}

export function getFeatureUsageRevisionColumn(
  query: WithColumnMapping,
): string {
  return query.columnMapping?.revisionColumn || "revision";
}

export function getFeatureUsageIdentifierColumn(
  query: WithColumnMapping,
  identifierType: string,
): string {
  return query.columnMapping?.userIdColumns?.[identifierType] || identifierType;
}

/**
 * Columns a saved query must return: the required ones, every column it maps,
 * and one per identifier type it declares.
 */
export function getFeatureUsageRequiredColumns(
  query: Pick<FeatureUsageQuery, "columnMapping" | "userIdTypes">,
): string[] {
  const mapping = query.columnMapping ?? {};
  return [
    ...new Set([
      getFeatureUsageTimestampColumn(query),
      getFeatureUsageFeatureKeyColumn(query),
      ...[
        mapping.environmentColumn,
        mapping.valueColumn,
        mapping.ruleIdColumn,
        mapping.variationIdColumn,
        mapping.sourceColumn,
        mapping.revisionColumn,
      ].filter((c): c is string => !!c),
      ...(query.userIdTypes ?? []).map((type) =>
        getRootColumn(getFeatureUsageIdentifierColumn(query, type)),
      ),
    ]),
  ];
}

export function findFeatureUsageColumnsNeedingQuotes(
  query: WithColumnMapping,
  fold: UnquotedIdentifierFold | undefined,
): string[] {
  const mapping = query.columnMapping ?? {};
  return findMappedColumnsNeedingQuotes(
    [
      mapping.timestampColumn,
      mapping.featureKeyColumn,
      mapping.environmentColumn,
      mapping.valueColumn,
      mapping.ruleIdColumn,
      mapping.variationIdColumn,
      mapping.sourceColumn,
      mapping.revisionColumn,
      // A JSON field's root is a column; the field itself is checked by
      // getFeatureUsageJsonFieldError
      ...Object.values(mapping.userIdColumns ?? {}).map(getRootColumn),
    ],
    fold,
  );
}

/**
 * Why a mapped JSON field can't be used, like validateColumnMappingTargets for
 * fact tables: one level, plain names, and a root that is a JSON column.
 */
export function getFeatureUsageJsonFieldError(
  query: WithColumnMapping & WithColumns,
): string | null {
  for (const [type, column] of Object.entries(
    query.columnMapping?.userIdColumns ?? {},
  )) {
    if (!column.includes(".")) continue;
    const parts = splitFeatureUsageJsonField(column);
    if (!parts) {
      return `The ${type} identifier "${column}" goes more than one level into a JSON column. Only one level, like "attributes.${type}", is supported.`;
    }
    if (!PLAIN_NAME.test(parts.root) || !PLAIN_NAME.test(parts.field)) {
      return `The ${type} identifier "${column}" must be a JSON column and a field name made of letters, numbers and underscores.`;
    }
    if (!isJsonColumn(query, parts.root)) {
      return `The ${type} identifier "${column}" reads a field from "${parts.root}", which isn't a JSON column.`;
    }
  }
  return null;
}

/**
 * SQL that reads an identifier, extracting a JSON field with the warehouse's
 * syntax when it's mapped to one, like getColumnExpression for fact tables.
 */
export function getFeatureUsageIdentifierExpression(
  query: WithColumnMapping & WithColumns,
  identifierType: string,
  dialect: Pick<SqlDialect, "jsonExtract">,
  alias = "",
): string {
  const column = getFeatureUsageIdentifierColumn(query, identifierType);
  const prefix = alias ? `${alias}.` : "";
  const parts = splitFeatureUsageJsonField(column);
  if (parts && isJsonColumn(query, parts.root)) {
    return dialect.jsonExtract(`${prefix}${parts.root}`, parts.field, false);
  }
  return `${prefix}${column}`;
}
