import { getAffectedEnvsForExperiment } from "shared/util";
import { PostExperimentVisualChangesetResponse } from "shared/types/openapi";
import { VisualChangesetURLPattern } from "shared/types/visual-changeset";
import { postExperimentVisualChangesetValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
import {
  createVisualChangeset,
  toVisualChangesetApiInterface,
} from "back-end/src/models/VisualChangesetModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const postExperimentVisualChangeset = createApiRequestHandler(
  postExperimentVisualChangesetValidator,
)(async (req): Promise<PostExperimentVisualChangesetResponse> => {
  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) {
    throw new Error("Could not find experiment");
  }

  const linkedFeatureIds = experiment.linkedFeatures || [];
  const linkedFeatures = await getFeaturesByIds(req.context, linkedFeatureIds);

  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: req.organization.settings?.environments || [],
    linkedFeatures,
  });

  if (
    envs.length > 0 &&
    !req.context.permissions.canRunExperiment(experiment, envs)
  ) {
    req.context.permissions.throwPermissionError();
  }

  const urlPatterns: VisualChangesetURLPattern[] = req.body.urlPatterns.map(
    (p) => ({
      type: p.type,
      pattern: p.pattern,
      include: p.include ?? true,
    }),
  );

  const visualChangeset = await createVisualChangeset({
    experiment,
    urlPatterns,
    editorUrl: req.body.editorUrl,
    context: req.context,
  });

  return {
    visualChangeset: toVisualChangesetApiInterface(visualChangeset),
  };
});
