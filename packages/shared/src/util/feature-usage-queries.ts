import type {
  FeatureUsageQuery,
  FeatureUsageQueryColumnMapping,
} from "shared/types/datasource";
import type { UnquotedIdentifierFold } from "shared/types/sql";
import { findMappedColumnsNeedingQuotes } from "./exposure-queries";

type WithColumnMapping = { columnMapping?: FeatureUsageQueryColumnMapping };

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
        getFeatureUsageIdentifierColumn(query, type),
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
      ...Object.values(mapping.userIdColumns ?? {}),
    ],
    fold,
  );
}
