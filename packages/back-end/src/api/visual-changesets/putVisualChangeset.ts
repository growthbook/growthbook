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
import { requireVisualChangeWrite } from "back-end/src/api/visual-editor-ai/requireDraftExperiment";

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
  // Re-checked on every save so a stale editor can't clobber a test started since it loaded.
  const auditLiveEdit = requireVisualChangeWrite(req, experiment, {
    allowRunning: !!req.body.allowRunningExperiment,
    visualChangesetId: visualChangeset.id,
  });

  const updates: VisualChangesetUpdates = {
    ...omit(req.body, ["urlPatterns", "allowRunningExperiment"]),
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

  const res = await updateVisualChangeset({
    visualChangeset,
    experiment,
    context: req.context,
    updates,
  });
  await auditLiveEdit();

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
