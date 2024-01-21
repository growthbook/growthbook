import { CreateFactMetricProps } from "../../../types/fact-table";
import { PostFactMetricResponse } from "../../../types/openapi";
import {
  createFactMetric,
  toFactMetricApiInterface,
} from "../../models/FactMetricModel";
import { getFactTable } from "../../models/FactTableModel";
import { addTags } from "../../models/TagModel";
import { createApiRequestHandler } from "../../util/handler";
import { postFactMetricValidator } from "../../validators/openapi";

export const postFactMetric = createApiRequestHandler(postFactMetricValidator)(
  async (req): Promise<PostFactMetricResponse> => {
    req.checkPermissions("createMetrics", req.body.projects || "");

    const data: CreateFactMetricProps = {
      loseRisk: 0,
      winRisk: 0,
      maxPercentChange: 0,
      minPercentChange: 0,
      minSampleSize: 0,
      description: "",
      owner: "",
      projects: [],
      tags: [],
      inverse: false,
      capValue: 0,
      regressionAdjustmentOverride: false,
      regressionAdjustmentDays: 0,
      regressionAdjustmentEnabled: false,
      conversionDelayHours: 0,
      conversionWindowValue: 0,
      conversionWindowUnit: "hours",
      hasConversionWindow: false,
      ...req.body,
      capping: (req.body.capping === "none" ? "" : req.body.capping) || "",
      denominator: req.body.denominator || null,
    };

    const numeratorFactTable = await getFactTable(
      req.organization.id,
      data.numerator.factTableId
    );
    if (!numeratorFactTable) {
      throw new Error("Could not find numerator fact table");
    }

    if (data.metricType === "ratio") {
      if (!data.denominator) {
        throw new Error("Denominator required for ratio metric");
      }
      if (data.denominator.factTableId !== data.numerator.factTableId) {
        const denominatorFactTable = await getFactTable(
          req.organization.id,
          data.denominator.factTableId
        );
        if (!denominatorFactTable) {
          throw new Error("Could not find denominator fact table");
        }
      }
    } else if (data.denominator) {
      throw new Error("Denominator not allowed for non-ratio metric");
    }

    const factMetric = await createFactMetric(req.organization.id, data);

    if (factMetric.tags.length > 0) {
      await addTags(req.organization.id, factMetric.tags);
    }

    return {
      factMetric: toFactMetricApiInterface(factMetric),
    };
  }
);
