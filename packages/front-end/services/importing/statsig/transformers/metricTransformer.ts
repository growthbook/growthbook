import {
  ColumnRef,
  CreateFactMetricProps,
  FactMetricType,
  MetricCappingSettings,
  MetricQuantileSettings,
  MetricWindowSettings,
} from "back-end/types/fact-table";
import {
  DEFAULT_LOSE_RISK_THRESHOLD,
  DEFAULT_MAX_PERCENT_CHANGE,
  DEFAULT_MIN_PERCENT_CHANGE,
  DEFAULT_MIN_SAMPLE_SIZE,
  DEFAULT_WIN_RISK_THRESHOLD,
} from "shared/constants";
import {
  StatsigMetric,
  StatsigMetricCriteria,
} from "@/services/importing/statsig/types";

/**
 * Transform Statsig metric source to GrowthBook fact table
 */
export async function transformStatsigMetricToMetric(
  metric: StatsigMetric,
  apiCall: (
    path: string,
    options?: { method: string; body: string },
  ) => Promise<unknown>,
  metricSourceIdMap: Map<string, string>,
  project?: string,
  datasource?: string,
): Promise<CreateFactMetricProps> {
  if (!datasource) {
    throw new Error("Datasource is required to create metrics");
  }

  // Only support warehouse native for now
  if (!metric.warehouseNative) {
    throw new Error("Only warehouse native metrics are supported currently");
  }

  const data = metric.warehouseNative;

  const factTableId = metricSourceIdMap?.get(data.metricSourceName || "");
  if (!factTableId) {
    throw new Error(
      `Fact table for metric source ${data.metricSourceName} not found`,
    );
  }

  // TODO: ensure userIdTypes exists in the data source

  const inlineFilters = transformStatsigCriteriaToInlineFilter(
    data.criteria || [],
  );

  let metricType: FactMetricType;
  const numerator: ColumnRef = {
    column: data.valueColumn || "",
    factTableId,
    filters: [],
    aggregation: "sum",
    inlineFilters,
  };
  let denominator: ColumnRef | null = null;
  let quantileSettings: MetricQuantileSettings | null = null;
  const cappingSettings: MetricCappingSettings = {
    type: "",
    value: 0,
    ignoreZeros: false,
  };
  const windowSettings: MetricWindowSettings = {
    type: "",
    delayUnit: "days",
    delayValue: 0,
    windowUnit: "days",
    windowValue: 0,
  };

  // TODO: how are proportion metrics represented in Statsig?

  if (data.aggregation === "sum") {
    metricType = "mean";
  } else if (data.aggregation === "mean") {
    // Ratio of sum / count
    metricType = "ratio";
    denominator = {
      column: "$$count",
      factTableId,
      filters: [],
      aggregation: "sum",
      inlineFilters,
    };
  } else if (data.aggregation === "count") {
    metricType = "mean";
    numerator.column = "$$count";
  } else if (data.aggregation === "count_distinct") {
    metricType = "mean";
    numerator.aggregation = "count distinct";
  } else if (data.aggregation === "max") {
    metricType = "mean";
    numerator.aggregation = "max";
  } else if (data.aggregation === "ratio") {
    metricType = "ratio";

    if (data.numeratorAggregation === "count") {
      numerator.column = "$$count";
    } else if (data.numeratorAggregation === "count_distinct") {
      numerator.aggregation = "count distinct";
    } else if (data.numeratorAggregation === "max") {
      numerator.aggregation = "max";
    } else if (data.numeratorAggregation === "sum") {
      // already set
    } else {
      throw new Error(
        `Unsupported numerator aggregation type ${data.numeratorAggregation} for ratio metric`,
      );
    }

    const denominatorFactTableId = metricSourceIdMap?.get(
      data.denominatorMetricSourceName || data.metricSourceName || "",
    );
    if (!denominatorFactTableId) {
      throw new Error(
        `Fact table for denominator metric source ${data.denominatorMetricSourceName} not found`,
      );
    }

    denominator = {
      column: data.denominatorValueColumn || "",
      factTableId: denominatorFactTableId,
      filters: [],
      aggregation: "sum",
      inlineFilters: transformStatsigCriteriaToInlineFilter(
        data.denominatorCriteria || [],
      ),
    };
    if (data.denominatorAggregation === "count") {
      denominator.column = "$$count";
    } else if (data.denominatorAggregation === "count_distinct") {
      denominator.aggregation = "count distinct";
    } else if (data.denominatorAggregation === "max") {
      denominator.aggregation = "max";
    } else if (data.denominatorAggregation === "sum") {
      // already set
    } else {
      throw new Error(
        `Unsupported denominator aggregation type ${data.denominatorAggregation} for ratio metric`,
      );
    }
  } else if (data.aggregation === "percentile") {
    metricType = "quantile";

    let percentile = data.percentile || 0.5;
    if (percentile > 1 && percentile <= 100) {
      percentile = percentile / 100;
    }

    quantileSettings = {
      type: "event",
      quantile: percentile,
      ignoreZeros: false,
    };
  } else {
    throw new Error(`Unsupported aggregation type ${data.aggregation}`);
  }

  if (!numerator.column) {
    throw new Error("Numerator column is required");
  }
  if (denominator && !denominator.column) {
    throw new Error("Denominator column is required for ratio metrics");
  }

  if (data.winsorizationHigh) {
    cappingSettings.type = "percentile";
    cappingSettings.value = data.winsorizationHigh;

    // TODO: reject if denominator has separate winsorization settings
    // TODO: reject if using winsorizationLow (not supported)
  }

  return {
    name: metric.name,
    datasource,
    description: metric.description || "",
    tags: metric.tags || [],
    owner: metric.owner?.ownerName || "",
    projects: project ? [project] : [],
    archived: false,
    managedBy:
      metric.isVerified || metric.isReadOnly || metric.isPermanent
        ? "admin"
        : "",
    metricType,
    numerator,
    denominator,
    quantileSettings,
    cappingSettings,
    priorSettings: {
      override: false,
      mean: 0,
      proper: false,
      stddev: 0,
    },
    inverse: metric.directionality === "decrease",
    loseRisk: DEFAULT_LOSE_RISK_THRESHOLD,
    maxPercentChange: DEFAULT_MAX_PERCENT_CHANGE,
    minPercentChange: DEFAULT_MIN_PERCENT_CHANGE,
    minSampleSize: DEFAULT_MIN_SAMPLE_SIZE,
    winRisk: DEFAULT_WIN_RISK_THRESHOLD,
    regressionAdjustmentEnabled: false,
    regressionAdjustmentOverride: false,
    regressionAdjustmentDays: 14,
    targetMDE: 0,
    displayAsPercentage: false,
    windowSettings,
  };
}

function transformStatsigCriteriaToInlineFilter(
  criterias: StatsigMetricCriteria[],
): Record<string, string[]> {
  const filter: Record<string, string[]> = {};

  for (const criteria of criterias) {
    if (criteria.type !== "metadata") {
      throw new Error("Only metadata criteria are supported currently");
    }
    if (!criteria.column) {
      throw new Error("Column is required for criteria");
    }

    if (criteria.condition === "in") {
      filter[criteria.column] = criteria.value || [];
    } else if (criteria.condition === "=") {
      filter[criteria.column] = criteria.value || [];
    } else if (criteria.condition === "is_true") {
      filter[criteria.column] = ["true"];
    } else if (criteria.condition === "is_false") {
      filter[criteria.column] = ["false"];
    } else {
      // TODO: extract unsupported criteria into saved Fact Table filters
      throw new Error(
        `Unsupported condition ${criteria.condition} in criteria`,
      );
    }
  }

  return filter;
}
