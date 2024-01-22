import { UpdateFactMetricResponse } from "../../../types/openapi";
import {
  updateFactMetric as updateFactMetricInDb,
  toFactMetricApiInterface,
  getFactMetric,
} from "../../models/FactMetricModel";
import { addTagsDiff } from "../../models/TagModel";
import { createApiRequestHandler } from "../../util/handler";
import { updateFactMetricValidator } from "../../validators/openapi";

export const updateFactMetric = createApiRequestHandler(
  updateFactMetricValidator
)(
  async (req): Promise<UpdateFactMetricResponse> => {
    const factMetric = await getFactMetric(req.organization.id, req.params.id);

    if (!factMetric) {
      throw new Error("Could not find factMetric with that id");
    }
    req.checkPermissions("createMetrics", factMetric.projects);

    await updateFactMetricInDb(factMetric, {
      ...req.body,
      capping:
        (req.body.capping === "none" ? "" : req.body.capping) || undefined,
    });

    if (req.body.tags) {
      await addTagsDiff(req.organization.id, factMetric.tags, req.body.tags);
    }

    return {
      factMetric: toFactMetricApiInterface(factMetric),
    };
  }
);
