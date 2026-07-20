import { getConfigRevisionLatestValidator } from "shared/validators";
import { stringToBoolean } from "shared/util";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { assertUserScopedKeyForMine } from "./validations";
import { toApiConfigRevision } from "./toApiConfigRevision";

export const getConfigRevisionLatest = createApiRequestHandler(
  getConfigRevisionLatestValidator,
)(async (req) => {
  const config = await req.context.models.configs.getByKey(req.params.key);
  if (!config) {
    throw new NotFoundError("Could not find config");
  }

  const mine = stringToBoolean(req.query.mine?.toString());
  assertUserScopedKeyForMine(req.context, mine);

  const revision = await req.context.models.revisions.getLatestOpenByTarget(
    "config",
    config.id,
    { authorId: mine ? req.context.userId : undefined },
  );
  if (!revision) {
    throw new NotFoundError(
      mine
        ? "No active draft revision found for this config where you are the author"
        : "No active draft revision found for this config",
    );
  }

  return { revision: await toApiConfigRevision(revision, req.context) };
});
