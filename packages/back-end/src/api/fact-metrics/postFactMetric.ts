import { z } from "zod";
import { getScopedSettings } from "shared/settings";
import {
  DEFAULT_FACT_METRIC_WINDOW,
  DEFAULT_LOSE_RISK_THRESHOLD,
  DEFAULT_METRIC_WINDOW_DELAY_HOURS,
  DEFAULT_METRIC_WINDOW_HOURS,
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_WIN_RISK_THRESHOLD,
} from "shared/constants";
import { getSelectedColumnDatatype } from "shared/experiments";
import {
  ColumnRef,
  CreateFactMetricProps,
  FactTableInterface,
} from "back-end/types/fact-table";
import { PostFactMetricResponse } from "back-end/types/openapi";
import { getFactTable } from "back-end/src/models/FactTableModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { postFactMetricValidator } from "back-end/src/validators/openapi";
import { OrganizationInterface } from "back-end/types/organization";

export function validateAggregationSpecification({
  column,
  factTable,
  errorPrefix,
}: {
  column: ColumnRef;
  factTable: FactTableInterface;
  errorPrefix?: string;
}) {
  const datatype = getSelectedColumnDatatype({
    factTable,
    column: column.column,
  });
  if (column.aggregation === "count distinct" && datatype !== "string") {
    throw new Error(
      `${errorPrefix}Cannot use 'count distinct' aggregation with the special or numeric column '${column.column}'.`,
    );
  }
  if (datatype === "string" && column.aggregation !== "count distinct") {
    throw new Error(
      `${errorPrefix}Must use 'count distinct' aggregation with string column '${column.column}'.`,
    );
  }
}

export async function getCreateMetricPropsFromBody(
  body: z.infer<typeof postFactMetricValidator.bodySchema>,
  organization: OrganizationInterface,
  getFactTable: (id: string) => Promise<FactTableInterface | null>,
): Promise<CreateFactMetricProps> {
  const { settings: scopedSettings } = getScopedSettings({
    organization,
  });

  const factTable = await getFactTable(body.numerator.factTableId);
  if (!factTable) {
    throw new Error("Could not find fact table");
  }

  const {
    quantileSettings,
    cappingSettings,
    windowSettings,
    regressionAdjustmentSettings,
    numerator,
    denominator,
    riskThresholdSuccess,
    riskThresholdDanger,
    minPercentChange,
    maxPercentChange,
    minSampleSize,
    targetMDE,
    ...otherFields
  } = body;

  const cleanedNumerator = {
    filters: [],
    inlineFilters: {},
    ...numerator,
    column:
      body.metricType === "proportion" || body.metricType === "retention"
        ? "$$distinctUsers"
        : body.numerator.column || "$$distinctUsers",
  };

  validateAggregationSpecification({
    errorPrefix: "Numerator misspecified. ",
    column: cleanedNumerator,
    factTable: factTable,
  });

  const data: CreateFactMetricProps = {
    datasource: factTable.datasource,
    loseRisk:
      riskThresholdDanger ||
      scopedSettings.loseRisk.value ||
      DEFAULT_LOSE_RISK_THRESHOLD,
    winRisk:
      riskThresholdSuccess ||
      scopedSettings.winRisk.value ||
      DEFAULT_WIN_RISK_THRESHOLD,
    maxPercentChange:
      maxPercentChange ||
      scopedSettings.metricDefaults.value.maxPercentageChange ||
      0,
    minPercentChange:
      minPercentChange ||
      scopedSettings.metricDefaults.value.minPercentageChange ||
      0,
    targetMDE:
      targetMDE || scopedSettings.metricDefaults.value.targetMDE || 0.1,
    minSampleSize:
      minSampleSize ||
      scopedSettings.metricDefaults.value.minimumSampleSize ||
      150,
    description: "",
    owner: "",
    projects: [],
    tags: [],
    inverse: false,
    quantileSettings: quantileSettings ?? null,
    windowSettings: {
      type: DEFAULT_FACT_METRIC_WINDOW,
      delayValue:
        windowSettings?.delayValue ??
        windowSettings?.delayHours ??
        DEFAULT_METRIC_WINDOW_DELAY_HOURS,
      delayUnit: windowSettings?.delayUnit ?? "hours",
      windowValue: DEFAULT_METRIC_WINDOW_HOURS,
      windowUnit: "hours",
    },
    cappingSettings: {
      type: "",
      value: 0,
    },
    priorSettings: {
      override: false,
      proper: false,
      mean: 0,
      stddev: DEFAULT_PROPER_PRIOR_STDDEV,
    },
    regressionAdjustmentOverride: false,
    regressionAdjustmentDays:
      scopedSettings.regressionAdjustmentDays.value || 0,
    regressionAdjustmentEnabled: !!scopedSettings.regressionAdjustmentEnabled,
    numerator: cleanedNumerator,
    denominator: null,
    metricAutoSlices: [],
    ...otherFields,
  };

  if (denominator) {
    data.denominator = {
      filters: [],
      inlineFilters: {},
      ...denominator,
      column: denominator.column || "$$distinctUsers",
    };
    const denominatorFactTable =
      denominator.factTableId === numerator.factTableId
        ? factTable
        : await getFactTable(denominator.factTableId);
    if (!denominatorFactTable) {
      throw new Error("Could not find denominator fact table");
    }
    validateAggregationSpecification({
      errorPrefix: "Denominator misspecified. ",
      column: data.denominator,
      factTable: denominatorFactTable,
    });
  }

  if (cappingSettings?.type && cappingSettings?.type !== "none") {
    data.cappingSettings.type = cappingSettings.type;
    data.cappingSettings.value = cappingSettings.value || 0;
  }

  if (windowSettings?.type && windowSettings?.type !== "none") {
    data.windowSettings.type = windowSettings.type;
    if (windowSettings.windowValue) {
      data.windowSettings.windowValue = windowSettings.windowValue;
    }
    if (windowSettings.windowUnit) {
      data.windowSettings.windowUnit = windowSettings.windowUnit;
    }
  }

  if (regressionAdjustmentSettings?.override) {
    data.regressionAdjustmentOverride = true;
    if (regressionAdjustmentSettings.enabled) {
      data.regressionAdjustmentEnabled = true;
    }
    if (regressionAdjustmentSettings.days) {
      data.regressionAdjustmentDays = regressionAdjustmentSettings.days;
    }
  }

  return data;
}

export const postFactMetric = createApiRequestHandler(postFactMetricValidator)(
  async (req): Promise<PostFactMetricResponse> => {
    if (
      req.body.metricAutoSlices &&
      req.body.metricAutoSlices.length > 0 &&
      !req.context.hasPremiumFeature("metric-slices")
    ) {
      throw new Error("Metric slices require an enterprise license");
    }

    const lookupFactTable = async (id: string) => getFactTable(req.context, id);

    const data = await getCreateMetricPropsFromBody(
      req.body,
      req.organization,
      lookupFactTable,
    );

    const factMetric = await req.context.models.factMetrics.create(data);

    return {
      factMetric: req.context.models.factMetrics.toApiInterface(factMetric),
    };
  },
);
