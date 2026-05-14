import { z } from "zod";
import { getAffectedEnvsForExperiment } from "shared/util";
import {
  deleteExperimentByIdForOrganization,
  getExperimentById,
} from "back-end/src/models/ExperimentModel";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
import { removeExperimentFromPresentations } from "back-end/src/services/presentations";
import { createApiRequestHandler } from "back-end/src/util/handler";

const deleteExperimentValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z
    .object({
      id: z.string().describe("The id of the requested resource"),
    })
    .strict(),
  responseSchema: z
    .object({
      deletedId: z.string(),
    })
    .strict(),
  summary: "Delete a single experiment",
  operationId: "deleteExperiment",
  tags: ["experiments"],
  method: "delete" as const,
  path: "/experiments/:id",
};

export const deleteExperiment = createApiRequestHandler(
  deleteExperimentValidator,
)(async (req) => {
  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) {
    throw new Error("Could not find experiment with that id");
  }
  if (experiment.type === "holdout") {
    throw new Error("Holdouts are not supported via this API");
  }
  if (!req.context.permissions.canDeleteExperiment(experiment)) {
    req.context.permissions.throwPermissionError();
  }

  const linkedFeatures = experiment.linkedFeatures?.length
    ? await getFeaturesByIds(req.context, experiment.linkedFeatures)
    : [];
  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: req.context.org.settings?.environments || [],
    linkedFeatures,
  });
  if (
    envs.length > 0 &&
    !req.context.permissions.canRunExperiment(experiment, envs)
  ) {
    req.context.permissions.throwPermissionError();
  }

  const cb = await req.context.models.contextualBandits.getByExperimentId(
    experiment.id,
  );
  if (cb) {
    await req.context.models.contextualBandits.delete(cb);
  }
  await Promise.all([
    deleteExperimentByIdForOrganization(req.context, experiment),
    removeExperimentFromPresentations(experiment.id),
  ]);

  return { deletedId: experiment.id };
});
