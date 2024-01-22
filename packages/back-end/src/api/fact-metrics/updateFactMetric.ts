import z from "zod";
import { UpdateFactMetricProps } from "../../../types/fact-table";
import { UpdateFactMetricResponse } from "../../../types/openapi";
import {
  updateFactMetric as updateFactMetricInDb,
  toFactMetricApiInterface,
  getFactMetric,
} from "../../models/FactMetricModel";
import { addTagsDiff } from "../../models/TagModel";
import { createApiRequestHandler } from "../../util/handler";
import { updateFactMetricValidator } from "../../validators/openapi";
import { getFactTable } from "../../models/FactTableModel";
import { validateFactMetric } from "./postFactMetric";

export function getUpdateFactMetricPropsFromBody(
  body: z.infer<typeof updateFactMetricValidator.bodySchema>
): UpdateFactMetricProps {
  const { numerator, denominator, capping, ...otherFields } = body;

  const updates: UpdateFactMetricProps = {
    ...otherFields,
  };

  const metricType = updates.metricType;

  if (capping) {
    updates.capping = capping === "none" ? "" : capping;
  }
  if (numerator) {
    updates.numerator = {
      filters: [],
      ...numerator,
      column:
        metricType === "proportion"
          ? "$$distinctUsers"
          : numerator.column || "$$distinctUsers",
    };
  }
  if (denominator) {
    updates.denominator = {
      filters: [],
      ...denominator,
      column: denominator.column || "$$distinctUsers",
    };
  }

  return updates;
}

export const updateFactMetric = createApiRequestHandler(
  updateFactMetricValidator
)(
  async (req): Promise<UpdateFactMetricResponse> => {
    const factMetric = await getFactMetric(req.organization.id, req.params.id);

    if (!factMetric) {
      throw new Error("Could not find factMetric with that id");
    }
    req.checkPermissions("createMetrics", factMetric.projects);

    const updates = getUpdateFactMetricPropsFromBody(req.body);

    await validateFactMetric({ ...factMetric, ...updates }, async (id) => {
      return getFactTable(req.organization.id, id);
    });

    await updateFactMetricInDb(factMetric, updates);

    if (updates.tags) {
      await addTagsDiff(req.organization.id, factMetric.tags, updates.tags);
    }

    return {
      factMetric: toFactMetricApiInterface(factMetric),
    };
  }
);
