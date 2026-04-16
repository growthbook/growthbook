import { getFeatureRevisionLatestValidator } from "shared/validators";
import { stringToBoolean } from "shared/util";
import { revisionToApiInterface } from "back-end/src/services/features";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getLatestActiveDraftForFeature } from "back-end/src/models/FeatureRevisionModel";

export const getFeatureRevisionLatest = createApiRequestHandler(
  getFeatureRevisionLatestValidator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  const mine = stringToBoolean(req.query.mine?.toString());
  if (mine && !req.context.userId) {
    throw new BadRequestError(
      "`mine=true` requires a user-scoped API key (the caller must be identifiable as a user).",
    );
  }

  const revision = await getLatestActiveDraftForFeature(
    req.context,
    req.organization.id,
    feature.id,
    { involvedUserId: mine ? req.context.userId : undefined },
  );
  if (!revision) {
    throw new NotFoundError(
      mine
        ? "No active draft revision found for this feature where you are the author or a contributor"
        : "No active draft revision found for this feature",
    );
  }

  return { revision: revisionToApiInterface(revision) };
});
