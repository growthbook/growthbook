import omit from "lodash/omit";
import { putVisualChangesetValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import {
  findVisualChangesetById,
  toVisualChangesetApiInterface,
  updateVisualChangeset,
  VisualChangesetUpdates,
} from "back-end/src/models/VisualChangesetModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { requireDraftExperiment } from "back-end/src/api/visual-editor-ai/requireDraftExperiment";
import { requireCbEditable } from "back-end/src/api/visual-editor-ai/requireCbEditable";

export const putVisualChangeset = createApiRequestHandler(
  putVisualChangesetValidator,
)(async (req) => {
  const visualChangeset = await findVisualChangesetById(
    req.params.id,
    req.organization.id,
  );
  if (!visualChangeset) {
    throw new Error("Visual Changeset not found");
  }

  const updates: VisualChangesetUpdates = {
    ...omit(req.body, ["urlPatterns"]),
    ...(req.body.urlPatterns !== undefined
      ? {
          urlPatterns: req.body.urlPatterns.map((p) => ({
            type: p.type,
            pattern: p.pattern,
            include: p.include ?? true,
          })),
        }
      : {}),
  };

  if (visualChangeset.contextualBandit) {
    const cb = await req.context.models.contextualBandits.getById(
      visualChangeset.contextualBandit,
    );
    if (!cb) {
      throw new Error("Contextual Bandit not found");
    }
    if (!req.context.permissions.canUpdateContextualBandit(cb, cb)) {
      req.context.permissions.throwPermissionError();
    }
    requireCbEditable(req.context, cb);

    const res = await updateVisualChangeset({
      visualChangeset,
      experiment: null,
      context: req.context,
      updates,
    });

    const updatedVisualChangeset = await findVisualChangesetById(
      req.params.id,
      req.organization.id,
    );

    return {
      nModified: res.nModified,
      visualChangeset: updatedVisualChangeset
        ? toVisualChangesetApiInterface(updatedVisualChangeset)
        : toVisualChangesetApiInterface(visualChangeset),
    };
  }

  const experiment = await getExperimentById(
    req.context,
    visualChangeset.experiment,
  );

  if (!experiment) {
    throw new Error("Experiment not found");
  }

  if (!req.context.permissions.canUpdateVisualChange(experiment)) {
    req.context.permissions.throwPermissionError();
  }
  requireDraftExperiment(req.context, experiment);

  const res = await updateVisualChangeset({
    visualChangeset,
    experiment,
    context: req.context,
    updates,
  });

  const updatedVisualChangeset = await findVisualChangesetById(
    req.params.id,
    req.organization.id,
  );

  return {
    nModified: res.nModified,
    visualChangeset: updatedVisualChangeset
      ? toVisualChangesetApiInterface(updatedVisualChangeset)
      : toVisualChangesetApiInterface(visualChangeset),
  };
});
