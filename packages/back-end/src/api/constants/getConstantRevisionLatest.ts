import { getConstantRevisionLatestValidator } from "shared/validators";
import { stringToBoolean } from "shared/util";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { assertUserScopedKeyForMine } from "./validations";
import { toApiConstantRevision } from "./toApiConstantRevision";

export const getConstantRevisionLatest = createApiRequestHandler(
  getConstantRevisionLatestValidator,
)(async (req) => {
  const constant = await req.context.models.constants.getByKey(req.params.key);
  if (!constant) {
    throw new NotFoundError("Could not find constant");
  }

  const mine = stringToBoolean(req.query.mine?.toString());
  assertUserScopedKeyForMine(req.context, mine);

  const revision = await req.context.models.revisions.getLatestOpenByTarget(
    "constant",
    constant.id,
    { authorId: mine ? req.context.userId : undefined },
  );
  if (!revision) {
    throw new NotFoundError(
      mine
        ? "No active draft revision found for this constant where you are the author"
        : "No active draft revision found for this constant",
    );
  }

  return { revision: await toApiConstantRevision(revision, req.context) };
});
