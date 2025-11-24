import {
  ColumnRef,
  CreateFactFilterProps,
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
  metricSourceIdMap: Map<string, string>,
  savedFiltersMap: Map<string, string>,
  project: string,
  datasource: string,
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

  function getFiltersFromCriteria(criterias: StatsigMetricCriteria[]): {
    filters: string[];
    inlineFilters: Record<string, string[]>;
  } {
    const filters: string[] = [];

    const remainingCriteria: StatsigMetricCriteria[] = [];
    for (const criteria of criterias) {
      const f = transformStatsigCriteriaToSavedFilter(criteria);
      if (f) {
        const key = `${factTableId}::${f}`;
        const savedFilterId = savedFiltersMap?.get(key);
        if (savedFilterId) {
          filters.push(savedFilterId);
        } else {
          remainingCriteria.push(criteria);
        }
      } else {
        remainingCriteria.push(criteria);
      }
    }

    const inlineFilters =
      transformStatsigCriteriaToInlineFilter(remainingCriteria);

    return { filters, inlineFilters };
  }

  let metricType: FactMetricType;
  const numerator: ColumnRef = {
    column: data.valueColumn || "",
    factTableId,
    aggregation: "sum",
    ...getFiltersFromCriteria(data.criteria || []),
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
  // TODO: support thresholds for proportion metrics

  if (data.aggregation === "sum") {
    metricType = "mean";
  } else if (data.aggregation === "mean") {
    // Ratio of sum / count
    metricType = "ratio";
    denominator = {
      column: "$$count",
      factTableId,
      aggregation: "sum",
      ...getFiltersFromCriteria(data.criteria || []),
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
  } else if (data.aggregation === "daily_participation") {
    metricType = "mean";
    numerator.column = "$$distinctDates";
  } else if (data.aggregation === "ratio") {
    metricType = "ratio";

    if (data.numeratorAggregation === "count") {
      numerator.column = "$$count";
    } else if (data.numeratorAggregation === "count_distinct") {
      numerator.aggregation = "count distinct";
    } else if (data.numeratorAggregation === "max") {
      numerator.aggregation = "max";
    } else if (data.numeratorAggregation === "daily_participation") {
      numerator.column = "$$distinctDates";
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
      aggregation: "sum",
      ...getFiltersFromCriteria(data.denominatorCriteria || []),
    };
    if (data.denominatorAggregation === "count") {
      denominator.column = "$$count";
    } else if (data.denominatorAggregation === "count_distinct") {
      denominator.aggregation = "count distinct";
    } else if (data.denominatorAggregation === "max") {
      denominator.aggregation = "max";
    } else if (data.denominatorAggregation === "sum") {
      // already set
    } else if (data.denominatorAggregation === "daily_participation") {
      denominator.column = "$$distinctDates";
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
  } else if (data.cap) {
    cappingSettings.type = "absolute";
    cappingSettings.value = data.cap;
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
    regressionAdjustmentEnabled: !!data.cupedAttributionWindow,
    regressionAdjustmentOverride: !!data.cupedAttributionWindow,
    regressionAdjustmentDays: data.cupedAttributionWindow || 0,
    targetMDE: 0,
    displayAsPercentage: false,
    windowSettings,
    metricAutoSlices: data.metricDimensionColumns || [],
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
      filter[criteria.column] = criteria.values || [];
    } else if (criteria.condition === "=") {
      filter[criteria.column] = criteria.values || [];
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

export function transformStatsigCriteriaToSavedFilter(
  criteria: StatsigMetricCriteria,
): string | null {
  // If it works as an inline filter, don't convert to saved filter
  try {
    transformStatsigCriteriaToInlineFilter([criteria]);
    return null;
  } catch {
    // ignore
  }

  if (criteria.type !== "metadata") {
    return null;
  }

  const values = criteria.values || [];

  if (criteria.condition === "sql_filter") {
    return values[0] ?? null;
  }

  if (!criteria.column) {
    return null;
  }

  const escapedValues = values.map((v) => v.replace(/'/g, "''"));

  const firstVal = escapedValues[0] ?? "";
  const isNumber = /^-?\d+(\.\d+)?$/.test(firstVal);
  const quotedFirstValue =
    firstVal === "" ? "''" : isNumber ? firstVal : `'${firstVal}'`;

  switch (criteria.condition) {
    case "in":
      return `${criteria.column} IN (${escapedValues.map((v) => `'${v}'`).join(", ")})`;
    case "not_in":
      return `${criteria.column} NOT IN (${escapedValues
        .map((v) => `'${v}'`)
        .join(", ")})`;
    case "is_true":
      return `${criteria.column} = TRUE`;
    case "is_false":
      return `${criteria.column} = FALSE`;
    case "=":
    case "<":
    case "<=":
    case ">":
    case ">=":
      return `${criteria.column} ${criteria.condition} ${quotedFirstValue}`;
    case "contains":
      return `${criteria.column} LIKE '%${escapedValues[0]}%'`;
    case "not_contains":
      return `${criteria.column} NOT LIKE '%${escapedValues[0]}%'`;
    case "is_null":
      return `${criteria.column} IS NULL`;
    case "non_null":
      return `${criteria.column} IS NOT NULL`;
    case "ends_with":
      return `${criteria.column} LIKE '%${escapedValues[0]}'`;
    case "starts_with":
      return `${criteria.column} LIKE '${escapedValues[0]}%'`;
    case "before_exposure":
    case "after_exposure":
      return null;
  }
}

export function getNewFiltersForMetricSource(
  metrics: StatsigMetric[],
  metricSourceName: string,
  existingFilters?: Set<string>,
): CreateFactFilterProps[] {
  existingFilters = existingFilters || new Set<string>();

  const filters: CreateFactFilterProps[] = [];

  metrics.forEach((m) => {
    // Numerator
    if (
      m.warehouseNative?.metricSourceName === metricSourceName &&
      m.warehouseNative?.criteria
    ) {
      m.warehouseNative.criteria.forEach((criteria) => {
        const filterValue = transformStatsigCriteriaToSavedFilter(criteria);
        if (filterValue && !existingFilters.has(filterValue)) {
          existingFilters.add(filterValue);
          filters.push({
            name: filterValue,
            value: filterValue,
            description: "",
          });
        }
      });
    }

    // Denominator
    if (
      m.warehouseNative?.denominatorMetricSourceName === metricSourceName &&
      m.warehouseNative?.denominatorCriteria
    ) {
      m.warehouseNative.denominatorCriteria.forEach((criteria) => {
        const filterValue = transformStatsigCriteriaToSavedFilter(criteria);
        if (filterValue && !existingFilters.has(filterValue)) {
          existingFilters.add(filterValue);
          filters.push({
            name: filterValue,
            value: filterValue,
            description: "",
          });
        }
      });
    }
  });

  return filters;
}
