import { bigQueryDialect } from "shared/dialects";
import type { ColumnRef, FactMetricInterface } from "shared/types/fact-table";
import { getAggregationMetadata } from "back-end/src/integrations/sql/fact-metrics/aggregation-metadata";
import { getMetricSourceTableSchema } from "back-end/src/integrations/sql/fact-metrics/metric-source-table-schema";
import { getAggregatedFactTableSchema } from "back-end/src/integrations/sql/fact-metrics/aggregated-fact-table-schema";
import { encodeMetricIdForColumnName } from "back-end/src/integrations/sql/fact-metrics/encode-metric-id-for-column-name";
import { factMetricFactory } from "../../../factories/FactMetric.factory";

const FT_ID = "ft_events";

function buildMetricWithUserFilter(
  metricType: FactMetricInterface["metricType"],
  aggregateFilterColumn: string,
): FactMetricInterface {
  const metric = factMetricFactory.build({ metricType });
  const numerator: ColumnRef = {
    factTableId: FT_ID,
    column: "$$distinctUsers",
    rowFilters: [],
    aggregateFilterColumn,
    aggregateFilter: ">= 10",
  };
  return { ...metric, numerator };
}

describe("getAggregationMetadata with a user-level aggregate filter", () => {
  it.each(["proportion", "retention"] as const)(
    "stores a %s metric's numeric filter column sum as float",
    (metricType) => {
      const metadata = getAggregationMetadata(bigQueryDialect, {
        metric: buildMetricWithUserFilter(metricType, "amount"),
        useDenominator: false,
      });
      expect(metadata.intermediateDataType).toBe("float");
      expect(metadata.partialAggregationFunction("col")).toBe(
        "SUM(COALESCE((col), 0))",
      );
      expect(metadata.reAggregationFunction("col")).toBe(
        "SUM(COALESCE((col), 0))",
      );
    },
  );

  it("keeps an integer type when the filter column is $$count", () => {
    const metadata = getAggregationMetadata(bigQueryDialect, {
      metric: buildMetricWithUserFilter("proportion", "$$count"),
      useDenominator: false,
    });
    expect(metadata.intermediateDataType).toBe("integer");
    expect(metadata.finalDataType).toBe("integer");
  });

  it("keeps the integer MAX path for proportion metrics without a filter", () => {
    const metric = factMetricFactory.build({
      metricType: "proportion",
      numerator: { factTableId: FT_ID, column: "$$distinctUsers" },
    });
    const metadata = getAggregationMetadata(bigQueryDialect, {
      metric,
      useDenominator: false,
    });
    expect(metadata.intermediateDataType).toBe("integer");
    expect(metadata.partialAggregationFunction("col")).toBe(
      "COALESCE(MAX(col), 0)",
    );
  });
});

describe("cache table schemas for metrics with a user-level aggregate filter", () => {
  it("uses FLOAT64 for a numeric filter column on BigQuery", () => {
    const metric = buildMetricWithUserFilter("proportion", "amount");
    const valueColumn = `${encodeMetricIdForColumnName(metric.id)}_value`;

    const metricSourceSchema = getMetricSourceTableSchema(
      bigQueryDialect,
      "user_id",
      FT_ID,
      [metric],
    );
    expect(metricSourceSchema.get(valueColumn)).toBe("FLOAT64");

    const aggregatedSchema = getAggregatedFactTableSchema(bigQueryDialect, {
      idType: "user_id",
      factTableId: FT_ID,
      metrics: [metric],
    });
    expect(aggregatedSchema.get(valueColumn)).toBe("FLOAT64");
  });

  it("uses INT64 for a $$count filter column on BigQuery", () => {
    const metric = buildMetricWithUserFilter("proportion", "$$count");
    const valueColumn = `${encodeMetricIdForColumnName(metric.id)}_value`;

    expect(
      getMetricSourceTableSchema(bigQueryDialect, "user_id", FT_ID, [
        metric,
      ]).get(valueColumn),
    ).toBe("INT64");
    expect(
      getAggregatedFactTableSchema(bigQueryDialect, {
        idType: "user_id",
        factTableId: FT_ID,
        metrics: [metric],
      }).get(valueColumn),
    ).toBe("INT64");
  });
});
