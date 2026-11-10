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

/**
 * Column types a JSON field can be read from. Text counts too, since every
 * warehouse's JSON extraction accepts text that holds JSON.
 */
export const FEATURE_USAGE_JSON_ROOT_TYPES = ["json", "string", ""];

// Unknown when the query's columns weren't stored, like queries saved by the API
const canHoldJson = (query: WithColumns, column: string) =>
  !query.columns ||
  query.columns.some(
    (c) =>
      c.column === column && FEATURE_USAGE_JSON_ROOT_TYPES.includes(c.datatype),
  );

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
 * Every column an identifier reads from, in order: the main one, then the
 * fallbacks. Apps that send the same id in different attributes map each one.
 */
export function getFeatureUsageIdentifierColumns(
  query: WithColumnMapping,
  identifierType: string,
): string[] {
  return [
    ...new Set([
      getFeatureUsageIdentifierColumn(query, identifierType),
      ...(query.columnMapping?.userIdFallbackColumns?.[identifierType] ?? []),
    ]),
  ].filter(Boolean);
}

/** Every mapped identifier column with its type, fallbacks included. */
function getMappedIdentifierColumns(
  query: WithColumnMapping,
): [type: string, column: string][] {
  const mapping = query.columnMapping ?? {};
  return [
    ...Object.entries(mapping.userIdColumns ?? {}),
    ...Object.entries(mapping.userIdFallbackColumns ?? {}).flatMap(
      ([type, columns]) => columns.map((c): [string, string] => [type, c]),
    ),
  ];
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
      ...(query.userIdTypes ?? []).flatMap((type) =>
        getFeatureUsageIdentifierColumns(query, type).map(getRootColumn),
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
      ...getMappedIdentifierColumns(query).map(([, c]) => getRootColumn(c)),
    ],
    fold,
  );
}

/**
 * Why a mapped JSON field can't be used, like validateColumnMappingTargets for
 * fact tables: one level, plain names, and a root that can hold JSON.
 */
export function getFeatureUsageJsonFieldError(
  query: WithColumnMapping & WithColumns,
): string | null {
  for (const [type, column] of getMappedIdentifierColumns(query)) {
    if (!column.includes(".")) continue;
    const parts = splitFeatureUsageJsonField(column);
    if (!parts) {
      return `The ${type} identifier "${column}" goes more than one level into a JSON column. Only one level, like "attributes.${type}", is supported.`;
    }
    if (!PLAIN_NAME.test(parts.root) || !PLAIN_NAME.test(parts.field)) {
      return `The ${type} identifier "${column}" must be a JSON column and a field name made of letters, numbers and underscores.`;
    }
    if (!canHoldJson(query, parts.root)) {
      return `The ${type} identifier "${column}" reads a field from "${parts.root}", which isn't a JSON or text column.`;
    }
  }
  return null;
}

/**
 * SQL that reads an identifier, extracting a JSON field with the warehouse's
 * syntax when it's mapped to one, like getColumnExpression for fact tables.
 * With fallbacks, it takes the first column that has a value.
 */
export function getFeatureUsageIdentifierExpression(
  query: WithColumnMapping & WithColumns,
  identifierType: string,
  dialect: Pick<SqlDialect, "jsonExtract" | "castToString">,
  alias = "",
): string {
  const prefix = alias ? `${alias}.` : "";
  const read = (column: string) => {
    // A dotted name is always a JSON field: real column names with dots are
    // rejected on save because they'd need quoting
    const parts = splitFeatureUsageJsonField(column);
    return parts
      ? dialect.jsonExtract(`${prefix}${parts.root}`, parts.field, false)
      : `${prefix}${column}`;
  };
  const columns = getFeatureUsageIdentifierColumns(query, identifierType);
  if (columns.length === 1) return read(columns[0]);
  // Cast so a numeric column and a JSON field (text) can be combined, and skip
  // empty strings, which some warehouses return for a missing JSON field
  const values = columns.map(
    (c) => `NULLIF(${dialect.castToString(read(c))}, '')`,
  );
  return `COALESCE(${values.join(", ")})`;
}
