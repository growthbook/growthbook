import { MetricInterface } from "back-end/types/metric";
import {
  FactMetricInterface,
  FactTableMap,
  MetricWindowSettings,
} from "back-end/types/fact-table";
import { TemplateVariables } from "back-end/types/sql";
import { OrganizationSettings } from "back-end/types/organization";
import { MetricOverride } from "back-end/types/experiment";
import { MetricRegressionAdjustmentStatus } from "back-end/types/report";
import cloneDeep from "lodash/cloneDeep";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import {
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
} from "./constants";

export type ExperimentMetricInterface = MetricInterface | FactMetricInterface;

export function isFactMetricId(id: string): boolean {
  return !!id.match(/^fact__/);
}

export function isFactMetric(
  m: ExperimentMetricInterface
): m is FactMetricInterface {
  return "metricType" in m;
}

export function getMetricTemplateVariables(
  m: ExperimentMetricInterface,
  factTableMap: FactTableMap,
  useDenominator?: boolean
): TemplateVariables {
  if (isFactMetric(m)) {
    const columnRef = useDenominator ? m.denominator : m.numerator;
    if (!columnRef) return {};

    const factTable = factTableMap.get(columnRef.factTableId);
    if (!factTable) return {};

    return {
      eventName: factTable.eventName,
    };
  }

  return m.templateVariables || {};
}

export function isBinomialMetric(m: ExperimentMetricInterface) {
  if (isFactMetric(m)) return m.metricType === "proportion";
  return m.type === "binomial";
}

export function isRatioMetric(
  m: ExperimentMetricInterface,
  denominatorMetric?: ExperimentMetricInterface
): boolean {
  if (isFactMetric(m)) return m.metricType === "ratio";
  return !!denominatorMetric && !isBinomialMetric(denominatorMetric);
}

export function isFunnelMetric(
  m: ExperimentMetricInterface,
  denominatorMetric?: ExperimentMetricInterface
): boolean {
  if (isFactMetric(m)) return false;
  return !!denominatorMetric && isBinomialMetric(denominatorMetric);
}

export function isRegressionAdjusted(
  m: ExperimentMetricInterface,
  denominatorMetric?: ExperimentMetricInterface
) {
  return (
    (m.regressionAdjustmentDays ?? 0) > 0 &&
    !!m.regressionAdjustmentEnabled &&
    !isRatioMetric(m, denominatorMetric)
  );
}

export function getConversionWindowHours(
  windowSettings: MetricWindowSettings
): number {
  const value = windowSettings.windowValue;
  if (windowSettings.windowUnit === "hours") return value;
  if (windowSettings.windowUnit === "days") return value * 24;
  if (windowSettings.windowUnit === "weeks") return value * 24 * 7;

  // TODO
  return 72;
}

export function getUserIdTypes(
  metric: ExperimentMetricInterface,
  factTableMap: FactTableMap,
  useDenominator?: boolean
): string[] {
  if (isFactMetric(metric)) {
    const factTable = factTableMap.get(
      useDenominator
        ? metric.denominator?.factTableId || ""
        : metric.numerator.factTableId
    );
    return factTable?.userIdTypes || [];
  }

  return metric.userIdTypes || [];
}

export function getMetricLink(id: string): string {
  if (isFactMetricId(id)) return `/fact-metrics/${id}`;
  return `/metric/${id}`;
}

export function getRegressionAdjustmentsForMetric<
  T extends ExperimentMetricInterface
>({
  metric,
  denominatorMetrics,
  experimentRegressionAdjustmentEnabled,
  organizationSettings,
  metricOverrides,
}: {
  metric: T;
  denominatorMetrics: MetricInterface[];
  experimentRegressionAdjustmentEnabled: boolean;
  organizationSettings?: Partial<OrganizationSettings>; // can be RA fields from a snapshot of org settings
  metricOverrides?: MetricOverride[];
}): {
  newMetric: T;
  metricRegressionAdjustmentStatus: MetricRegressionAdjustmentStatus;
} {
  const newMetric = cloneDeep<T>(metric);

  // start with default RA settings
  let regressionAdjustmentAvailable = true;
  let regressionAdjustmentEnabled = false;
  let regressionAdjustmentDays = DEFAULT_REGRESSION_ADJUSTMENT_DAYS;
  let reason = "";

  // get RA settings from organization
  if (organizationSettings?.regressionAdjustmentEnabled) {
    regressionAdjustmentEnabled = true;
    regressionAdjustmentDays =
      organizationSettings?.regressionAdjustmentDays ??
      regressionAdjustmentDays;
  }
  if (experimentRegressionAdjustmentEnabled) {
    regressionAdjustmentEnabled = true;
  }

  // get RA settings from metric
  if (metric?.regressionAdjustmentOverride) {
    regressionAdjustmentEnabled = !!metric?.regressionAdjustmentEnabled;
    regressionAdjustmentDays =
      metric?.regressionAdjustmentDays ?? DEFAULT_REGRESSION_ADJUSTMENT_DAYS;
    if (!regressionAdjustmentEnabled) {
      regressionAdjustmentAvailable = false;
      reason = "disabled in metric settings";
    }
  }

  // get RA settings from metric override
  if (metricOverrides) {
    const metricOverride = metricOverrides.find((mo) => mo.id === metric.id);
    if (metricOverride?.regressionAdjustmentOverride) {
      regressionAdjustmentEnabled = !!metricOverride?.regressionAdjustmentEnabled;
      regressionAdjustmentDays =
        metricOverride?.regressionAdjustmentDays ?? regressionAdjustmentDays;
      if (!regressionAdjustmentEnabled) {
        regressionAdjustmentAvailable = false;
        if (!metric.regressionAdjustmentEnabled) {
          reason = "disabled in metric settings and metric override";
        } else {
          reason = "disabled by metric override";
        }
      } else {
        regressionAdjustmentAvailable = true;
        reason = "";
      }
    }
  }

  // final gatekeeping
  if (regressionAdjustmentEnabled) {
    if (metric && isFactMetric(metric) && isRatioMetric(metric)) {
      // is this a fact ratio metric?
      regressionAdjustmentEnabled = false;
      regressionAdjustmentAvailable = false;
      reason = "ratio metrics not supported";
    }
    if (metric?.denominator) {
      // is this a classic "ratio" metric (denominator unsupported type)?
      const denominator = denominatorMetrics.find(
        (m) => m.id === metric?.denominator
      );
      if (denominator && !isBinomialMetric(denominator)) {
        regressionAdjustmentEnabled = false;
        regressionAdjustmentAvailable = false;
        reason = `denominator is ${denominator.type}`;
      }
    }
    if (metric && !isFactMetric(metric) && metric?.aggregation) {
      regressionAdjustmentEnabled = false;
      regressionAdjustmentAvailable = false;
      reason = "custom aggregation";
    }
  }

  regressionAdjustmentDays = regressionAdjustmentEnabled
    ? regressionAdjustmentDays
    : 0;

  newMetric.regressionAdjustmentEnabled = regressionAdjustmentEnabled;
  newMetric.regressionAdjustmentDays = regressionAdjustmentDays;

  return {
    newMetric,
    metricRegressionAdjustmentStatus: {
      metric: newMetric.id,
      regressionAdjustmentEnabled,
      regressionAdjustmentAvailable,
      regressionAdjustmentDays,
      reason,
    },
  };
}

export function getAllMetricRegressionAdjustmentStatuses({
  allExperimentMetrics,
  denominatorMetrics,
  orgSettings,
  statsEngine,
  experimentRegressionAdjustmentEnabled,
  experimentMetricOverrides = [],
  datasourceType,
  hasRegressionAdjustmentFeature,
}: {
  allExperimentMetrics: (ExperimentMetricInterface | null)[];
  denominatorMetrics: MetricInterface[];
  orgSettings: OrganizationSettings;
  statsEngine: string;
  experimentRegressionAdjustmentEnabled?: boolean;
  experimentMetricOverrides?: MetricOverride[];
  datasourceType?: DataSourceInterfaceWithParams["type"];
  hasRegressionAdjustmentFeature: boolean;
}) {
  const metricRegressionAdjustmentStatuses: MetricRegressionAdjustmentStatus[] = [];
  let regressionAdjustmentAvailable = true;
  let regressionAdjustmentEnabled = true;
  let regressionAdjustmentHasValidMetrics = false;
  if (allExperimentMetrics.length === 0) {
    regressionAdjustmentHasValidMetrics = true; // avoid awkward UI warning
  }
  for (const metric of allExperimentMetrics) {
    if (!metric) continue;
    const {
      metricRegressionAdjustmentStatus,
    } = getRegressionAdjustmentsForMetric({
      metric: metric,
      denominatorMetrics: denominatorMetrics,
      experimentRegressionAdjustmentEnabled:
        experimentRegressionAdjustmentEnabled ??
        DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
      organizationSettings: orgSettings,
      metricOverrides: experimentMetricOverrides,
    });
    if (metricRegressionAdjustmentStatus.regressionAdjustmentEnabled) {
      regressionAdjustmentEnabled = true;
    }
    if (metricRegressionAdjustmentStatus.regressionAdjustmentAvailable) {
      regressionAdjustmentHasValidMetrics = true;
    }
    metricRegressionAdjustmentStatuses.push(metricRegressionAdjustmentStatus);
  }
  if (!experimentRegressionAdjustmentEnabled) {
    regressionAdjustmentEnabled = false;
  }
  if (statsEngine === "bayesian") {
    regressionAdjustmentAvailable = false;
    regressionAdjustmentEnabled = false;
  }
  if (
    !datasourceType ||
    datasourceType === "google_analytics" ||
    datasourceType === "mixpanel"
  ) {
    // these do not implement getExperimentMetricQuery
    regressionAdjustmentAvailable = false;
    regressionAdjustmentEnabled = false;
  }
  if (!hasRegressionAdjustmentFeature) {
    regressionAdjustmentEnabled = false;
  }
  return {
    regressionAdjustmentAvailable,
    regressionAdjustmentEnabled,
    metricRegressionAdjustmentStatuses,
    regressionAdjustmentHasValidMetrics,
  };
}
