import { deleteVisualChangesetValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import {
  deleteVisualChangesetById,
  findVisualChangesetById,
} from "back-end/src/models/VisualChangesetModel";
import { assertCanRunExperimentInAffectedEnvironments } from "back-end/src/services/experiments";
import { NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const deleteVisualChangeset = createApiRequestHandler(
  deleteVisualChangesetValidator,
)(async (req) => {
  const { context } = req;
  const visualChangeset = await findVisualChangesetById(
    req.params.id,
    context.org.id,
  );
  if (!visualChangeset) throw new NotFoundError("Visual Changeset not found");

  // Same gate as the app: running the experiment where the change is served
  const experiment = await getExperimentById(
    context,
    visualChangeset.experiment,
  );
  if (experiment) {
    await assertCanRunExperimentInAffectedEnvironments(context, experiment);
  } else if (!context.permissions.canRunExperiment({}, [])) {
    context.permissions.throwPermissionError();
  }

  await deleteVisualChangesetById({ visualChangeset, experiment, context });
  return { deletedId: visualChangeset.id };
});
