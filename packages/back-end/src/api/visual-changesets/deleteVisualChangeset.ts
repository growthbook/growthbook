import { deleteVisualChangesetValidator } from "shared/validators";
import {
  deleteVisualChangesetById,
  findVisualChangesetById,
} from "back-end/src/models/VisualChangesetModel";
import {
  ContextualBanditChangesetOwner,
  ExperimentChangesetOwner,
  resolveChangesetOwner,
} from "back-end/src/services/changesetOwner";
import { assertCanRunExperimentInAffectedEnvironments } from "back-end/src/services/experiments";
import { NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getEnvironments } from "back-end/src/util/organization.util";

export const deleteVisualChangeset = createApiRequestHandler(
  deleteVisualChangesetValidator,
)(async (req) => {
  const { context } = req;
  const visualChangeset = await findVisualChangesetById(
    req.params.id,
    context.org.id,
  );
  if (!visualChangeset) throw new NotFoundError("Visual Changeset not found");

  // Same gates as the app: running the owner where the change is served
  const owner = await resolveChangesetOwner(context, visualChangeset);
  if (owner instanceof ContextualBanditChangesetOwner) {
    const envs = getEnvironments(context.org).map((e) => e.id);
    if (
      !owner.canUpdateOwner() ||
      !context.permissions.canRunContextualBandit(owner.cb, envs)
    ) {
      context.permissions.throwPermissionError();
    }
  } else if (owner instanceof ExperimentChangesetOwner) {
    await assertCanRunExperimentInAffectedEnvironments(
      context,
      owner.experiment,
    );
  } else if (!context.permissions.canRunExperiment({}, [])) {
    context.permissions.throwPermissionError();
  }

  await deleteVisualChangesetById({ visualChangeset, owner, context });
  return { deletedId: visualChangeset.id };
});
