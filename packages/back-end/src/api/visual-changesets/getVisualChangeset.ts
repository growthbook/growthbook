import {
  ExperimentInterfaceExcludingHoldouts,
  getVisualChangesetValidator,
} from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import {
  findVisualChangesetById,
  toVisualChangesetApiInterface,
} from "back-end/src/models/VisualChangesetModel";
import { toExperimentApiInterface } from "back-end/src/services/experiments";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { toVisualEditorCbExperimentStub } from "back-end/src/services/visualEditorCbStub";

export const getVisualChangeset = createApiRequestHandler(
  getVisualChangesetValidator,
)(async (req) => {
  const { organization } = req;
  const { includeExperiment = 0 } = req.query;

  const visualChangeset = await findVisualChangesetById(
    req.params.id,
    organization.id,
  );

  if (!visualChangeset) {
    throw new Error("Could not find visualChangeset with given ID");
  }

  if (visualChangeset.contextualBandit) {
    if (includeExperiment <= 0) {
      return {
        visualChangeset: toVisualChangesetApiInterface(visualChangeset),
      };
    }
    const cb = await req.context.models.contextualBandits.getById(
      visualChangeset.contextualBandit,
    );
    if (!cb) {
      return {
        visualChangeset: toVisualChangesetApiInterface(visualChangeset),
      };
    }
    return {
      visualChangeset: toVisualChangesetApiInterface(visualChangeset),
      experiment: toVisualEditorCbExperimentStub(cb),
    };
  }

  const experiment =
    includeExperiment > 0
      ? await getExperimentById(req.context, visualChangeset.experiment)
      : null;

  const apiExperiment =
    experiment && experiment.type !== "holdout"
      ? await toExperimentApiInterface(
          req.context,
          experiment as ExperimentInterfaceExcludingHoldouts,
        )
      : null;

  return {
    visualChangeset: toVisualChangesetApiInterface(visualChangeset),
    ...(apiExperiment ? { experiment: apiExperiment } : {}),
  };
});
