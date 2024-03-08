import z from "zod";
import { getScopedSettings } from "shared/settings";
import {
  DEFAULT_FACT_METRIC_WINDOW,
  DEFAULT_METRIC_WINDOW_DELAY_HOURS,
  DEFAULT_METRIC_WINDOW_HOURS,
} from "shared/constants";
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
import { findAllProjectsByOrganization } from "../../models/ProjectModel";

export async function validateFactMetric(
  data: Pick<FactMetricInterface, "numerator" | "denominator" | "metricType">,
  getFactTable: (id: string) => Promise<FactTableInterface | null>
) {
  const numeratorFactTable = await getFactTable(data.numerator.factTableId);
  if (!numeratorFactTable) {
    throw new Error("Could not find numerator fact table");
  }

  if (data.numerator.filters?.length) {
    for (const filter of data.numerator.filters) {
      if (!numeratorFactTable.filters.some((f) => f.id === filter)) {
        throw new Error(`Invalid numerator filter id: ${filter}`);
      }
    }
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
      if (denominatorFactTable.datasource !== numeratorFactTable.datasource) {
        throw new Error(
          "Numerator and denominator must be in the same datasource"
        );
      }

      if (data.denominator.filters?.length) {
        for (const filter of data.denominator.filters) {
          if (!denominatorFactTable.filters.some((f) => f.id === filter)) {
            throw new Error(`Invalid denominator filter id: ${filter}`);
          }
        }
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

  const {
    cappingSettings,
    windowSettings,
    regressionAdjustmentSettings,
    numerator,
    denominator,
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

    if (req.body.projects?.length) {
      const projects = await findAllProjectsByOrganization(req.context);
      const projectIds = new Set(projects.map((p) => p.id));
      for (const projectId of req.body.projects) {
        if (!projectIds.has(projectId)) {
          throw new Error(`Project ${projectId} not found`);
        }
      }
    }

    const data = await getCreateMetricPropsFromBody(
      req.body,
      req.organization,
      lookupFactTable
    );
    await validateFactMetric(data, lookupFactTable);

    req.context.pemissions.canCreateMetrics(data).throwIfError();

    const factMetric = await createFactMetric(req.context, data);

    if (factMetric.tags.length > 0) {
      await addTags(req.organization.id, factMetric.tags);
    }

    return {
      factMetric: toFactMetricApiInterface(factMetric),
    };
  }
);
