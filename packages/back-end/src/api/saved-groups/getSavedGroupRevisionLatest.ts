import { getSavedGroupRevisionLatestValidator } from "shared/validators";
import { stringToBoolean } from "shared/util";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { assertUserScopedKeyForMine } from "./validations";
import { toApiSavedGroupRevision } from "./toApiSavedGroupRevision";

export const getSavedGroupRevisionLatest = createApiRequestHandler(
  getSavedGroupRevisionLatestValidator,
)(async (req) => {
  const savedGroup = await req.context.models.savedGroups.getById(
    req.params.savedGroupId,
  );
  if (!savedGroup) {
    throw new NotFoundError("Could not find saved group");
  }

  const mine = stringToBoolean(req.query.mine?.toString());
  assertUserScopedKeyForMine(req.context, mine);

  const revision = await req.context.models.revisions.getLatestOpenByTarget(
    "saved-group",
    savedGroup.id,
    { authorId: mine ? req.context.userId : undefined },
  );
  if (!revision) {
    throw new NotFoundError(
      mine
        ? "No active draft revision found for this saved group where you are the author"
        : "No active draft revision found for this saved group",
    );
  }

  return {
    revision: await toApiSavedGroupRevision(revision, req.context),
  };
});
