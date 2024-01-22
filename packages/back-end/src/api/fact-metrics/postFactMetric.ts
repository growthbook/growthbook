import z from "zod";
import { getScopedSettings } from "shared/settings";
import {
  CreateFactMetricProps,
  FactMetricInterface,
  FactTableInterface,
} from "../../../types/fact-table";
import { PostFactMetricResponse } from "../../../types/openapi";
import {
  createFactMetric,
  toFactMetricApiInterface,
} from "../../models/FactMetricModel";
import { getFactTable } from "../../models/FactTableModel";
import { addTags } from "../../models/TagModel";
import { createApiRequestHandler } from "../../util/handler";
import { postFactMetricValidator } from "../../validators/openapi";
import { OrganizationInterface } from "../../../types/organization";

export async function validateFactMetric(
  data: Pick<FactMetricInterface, "numerator" | "denominator" | "metricType">,
  getFactTable: (id: string) => Promise<FactTableInterface | null>
) {
  const numeratorFactTable = await getFactTable(data.numerator.factTableId);
  if (!numeratorFactTable) {
    throw new Error("Could not find numerator fact table");
  }

  if (data.metricType === "ratio") {
    if (!data.denominator) {
      throw new Error("Denominator required for ratio metric");
    }
    if (data.denominator.factTableId !== data.numerator.factTableId) {
      const denominatorFactTable = await getFactTable(
        data.denominator.factTableId
      );
      if (!denominatorFactTable) {
        throw new Error("Could not find denominator fact table");
      }
    }
  } else if (data.denominator?.factTableId) {
    throw new Error("Denominator not allowed for non-ratio metric");
  }
}

export async function getCreateMetricPropsFromBody(
  body: z.infer<typeof postFactMetricValidator.bodySchema>,
  organization: OrganizationInterface,
  getFactTable: (id: string) => Promise<FactTableInterface | null>
): Promise<CreateFactMetricProps> {
  const { settings: scopedSettings } = getScopedSettings({
    organization,
  });

  const factTable = await getFactTable(body.numerator.factTableId);
  if (!factTable) {
    throw new Error("Could not find fact table");
  }

  return {
    datasource: factTable.datasource,
    loseRisk: scopedSettings.loseRisk.value || 0,
    winRisk: scopedSettings.winRisk.value || 0,
    maxPercentChange:
      scopedSettings.metricDefaults.value.maxPercentageChange || 0,
    minPercentChange:
      scopedSettings.metricDefaults.value.minPercentageChange || 0,
    minSampleSize: scopedSettings.metricDefaults.value.minimumSampleSize || 0,
    description: "",
    owner: "",
    projects: [],
    tags: [],
    inverse: false,
    capValue: 0,
    regressionAdjustmentOverride: false,
    regressionAdjustmentDays:
      scopedSettings.regressionAdjustmentDays.value || 0,
    regressionAdjustmentEnabled: !!scopedSettings.regressionAdjustmentEnabled,
    conversionDelayHours: scopedSettings.conversionDelayHours.value || 0,
    conversionWindowValue: scopedSettings.conversionWindowHours.value || 72,
    conversionWindowUnit: "hours",
    hasConversionWindow: false,
    ...body,
    capping: (body.capping === "none" ? "" : body.capping) || "",
    numerator: {
      filters: [],
      ...body.numerator,
      column:
        body.metricType === "proportion"
          ? "$$distinctUsers"
          : body.numerator.column || "$$distinctUsers",
    },
    denominator: body.denominator
      ? {
          filters: [],
          ...body.denominator,
          column: body.denominator.column || "$$distinctUsers",
        }
      : null,
  };
}

export const postFactMetric = createApiRequestHandler(postFactMetricValidator)(
  async (req): Promise<PostFactMetricResponse> => {
    req.checkPermissions("createMetrics", req.body.projects || "");

    const lookupFactTable = async (id: string) =>
      getFactTable(req.organization.id, id);

    const data = await getCreateMetricPropsFromBody(
      req.body,
      req.organization,
      lookupFactTable
    );
    await validateFactMetric(data, lookupFactTable);

    const factMetric = await createFactMetric(req.organization.id, data);

    if (factMetric.tags.length > 0) {
      await addTags(req.organization.id, factMetric.tags);
    }

    return {
      factMetric: toFactMetricApiInterface(factMetric),
    };
  }
);
