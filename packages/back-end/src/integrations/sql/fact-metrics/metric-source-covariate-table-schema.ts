import { isRatioMetric } from "shared/experiments";
import type { FactMetricInterface } from "shared/types/fact-table";
import type { SqlDialect } from "shared/types/sql";

import { encodeMetricIdForColumnName } from "back-end/src/integrations/sql/fact-metrics/encode-metric-id-for-column-name";
import { getAggregationMetadata } from "back-end/src/integrations/sql/fact-metrics/aggregation-metadata";

// Schema (column -> warehouse type) for a per-experiment covariate cache rooted
// in `factTableId`. Only the side(s) this FT hosts for each metric are stored.
export function getMetricSourceCovariateTableSchema(
  dialect: SqlDialect,
  baseIdType: string,
  factTableId: string,
  metrics: FactMetricInterface[],
): Map<string, string> {
  const schema = new Map<string, string>();

  schema.set(baseIdType, dialect.getDataType("string"));

  metrics.forEach((metric) => {
    const includeNumerator = metric.numerator.factTableId === factTableId;
    const includeDenominator =
      isRatioMetric(metric) && metric.denominator?.factTableId === factTableId;

    if (includeNumerator) {
      const numeratorMetadata = getAggregationMetadata(dialect, {
        metric,
        useDenominator: false,
      });
      schema.set(
        `${encodeMetricIdForColumnName(metric.id)}_value`,
        dialect.getDataType(numeratorMetadata.finalDataType),
      );
    }

    if (includeDenominator) {
      const denominatorMetadata = getAggregationMetadata(dialect, {
        metric,
        useDenominator: true,
      });
      schema.set(
        `${encodeMetricIdForColumnName(metric.id)}_denominator_value`,
        dialect.getDataType(denominatorMetadata.finalDataType),
      );
    }
  });

  return schema;
}

export function getMetricSourceCovariateTableColumns(
  dialect: SqlDialect,
  baseIdType: string,
  factTableId: string,
  metrics: FactMetricInterface[],
): string[] {
  return Array.from(
    getMetricSourceCovariateTableSchema(
      dialect,
      baseIdType,
      factTableId,
      metrics,
    ).keys(),
  );
}

export function getMetricSourceCovariateTableColumnDefinitions(
  dialect: SqlDialect,
  baseIdType: string,
  factTableId: string,
  metrics: FactMetricInterface[],
): string[] {
  return Array.from(
    getMetricSourceCovariateTableSchema(
      dialect,
      baseIdType,
      factTableId,
      metrics,
    ).entries(),
  ).map(([columnName, dataType]) => `${columnName} ${dataType}`);
}
