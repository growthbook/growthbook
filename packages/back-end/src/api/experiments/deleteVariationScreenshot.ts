import { z } from "zod";
import cloneDeep from "lodash/cloneDeep";
import { Changeset } from "shared/types/experiment";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { createApiRequestHandler } from "back-end/src/util/handler";

const deleteVariationScreenshotValidator = {
  paramsSchema: z
    .object({
      id: z.string(),
      variationId: z.string(),
    })
    .strict(),
  bodySchema: z
    .object({
      path: z
        .string()
        .describe("The screenshot path/URL to delete (from upload response)"),
    })
    .strict(),
  querySchema: z.never(),
  responseSchema: z.object({}).describe("Screenshot deleted successfully"),
  method: "delete" as const,
  path: "/experiments/:id/variation/:variationId/screenshot",
  operationId: "deleteVariationScreenshot",
  summary: "Delete a variation screenshot",
  tags: ["experiments"],
};

/** Strip query params for comparison - GET returns signed S3 URLs with ?X-Amz-... */
function normalizeScreenshotPath(path: string): string {
  return path.split("?")[0];
}

export const deleteVariationScreenshot = createApiRequestHandler(
  deleteVariationScreenshotValidator,
)(async (req) => {
  const context = req.context;
  const { id, variationId } = req.params;
  const { path } = req.body;

  const experiment = await getExperimentById(context, id);

  if (!experiment) {
    throw new Error("Experiment not found");
  }

  if (experiment.organization !== context.org.id) {
    throw new Error("You do not have access to this experiment");
  }

  const changes: Changeset = {};
  if (!context.permissions.canUpdateExperiment(experiment, changes)) {
    context.permissions.throwPermissionError();
  }

  const variationIndex = experiment.variations.findIndex(
    (v) => v.id === variationId,
  );
  if (variationIndex === -1) {
    throw new Error(`Unknown variation ${variationId}`);
  }

  const screenshots = experiment.variations[variationIndex].screenshots || [];
  const normalizedPath = normalizeScreenshotPath(path);
  const hasScreenshot = screenshots.some(
    (s) => normalizeScreenshotPath(s.path) === normalizedPath,
  );
  if (!hasScreenshot) {
    throw new Error("Screenshot not found");
  }

  changes.variations = cloneDeep(experiment.variations);
  changes.variations[variationIndex].screenshots = screenshots.filter(
    (s) => normalizeScreenshotPath(s.path) !== normalizedPath,
  );

  const updated = await updateExperiment({
    context,
    experiment,
    changes,
  });

  await req.audit({
    event: "experiment.screenshot.delete",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsUpdate(
      experiment.variations[variationIndex].screenshots,
      updated?.variations[variationIndex].screenshots,
      { variation: variationIndex },
    ),
  });

  return {};
});
