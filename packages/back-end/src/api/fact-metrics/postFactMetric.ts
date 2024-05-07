import z from "zod";
import { getScopedSettings } from "shared/settings";
import {
  DEFAULT_FACT_METRIC_WINDOW,
  DEFAULT_LOSE_RISK_THRESHOLD,
  DEFAULT_METRIC_WINDOW_DELAY_HOURS,
  DEFAULT_METRIC_WINDOW_HOURS,
  DEFAULT_WIN_RISK_THRESHOLD,
} from "shared/constants";
import {
  CreateFactMetricProps,
  FactTableInterface,
} from "../../../types/fact-table";
import { PostFactMetricResponse } from "../../../types/openapi";
import { getFactTable } from "../../models/FactTableModel";
import { createApiRequestHandler } from "../../util/handler";
import { postFactMetricValidator } from "../../validators/openapi";
import { OrganizationInterface } from "../../../types/organization";

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
    ...otherFields
  } = body;

  const cleanedNumerator = {
    filters: [],
    ...numerator,
    column:
      body.metricType === "proportion"
        ? "$$distinctUsers"
        : body.numerator.column || "$$distinctUsers",
  };

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
      type: scopedSettings.windowType.value ?? DEFAULT_FACT_METRIC_WINDOW,
      delayHours:
        scopedSettings.delayHours.value ?? DEFAULT_METRIC_WINDOW_DELAY_HOURS,
      windowValue:
        scopedSettings.windowHours.value ?? DEFAULT_METRIC_WINDOW_HOURS,
      windowUnit: "hours",
    },
    cappingSettings: {
      type: "",
      value: 0,
    },
    regressionAdjustmentOverride: false,
    regressionAdjustmentDays:
      scopedSettings.regressionAdjustmentDays.value || 0,
    regressionAdjustmentEnabled: !!scopedSettings.regressionAdjustmentEnabled,
    numerator: cleanedNumerator,
    denominator: null,
    ...otherFields,
  };

  if (denominator) {
    data.denominator = {
      filters: [],
      ...denominator,
      column: denominator.column || "$$distinctUsers",
    };
  }

  if (cappingSettings?.type && cappingSettings?.type !== "none") {
    data.cappingSettings.type = cappingSettings.type;
    data.cappingSettings.value = cappingSettings.value || 0;
  }
  if (windowSettings?.type && windowSettings?.type !== "none") {
    data.windowSettings.type = windowSettings.type;
    if (windowSettings.delayHours) {
      data.windowSettings.delayHours = windowSettings.delayHours;
    }
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
