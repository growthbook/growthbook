import { getFeatureRevisionLatestValidator } from "shared/validators";
import { stringToBoolean } from "shared/util";
import type { ApiReqContext } from "back-end/types/api";
import { toApiRevision } from "back-end/src/services/features";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getLatestActiveDraftForFeature } from "back-end/src/models/FeatureRevisionModel";

export async function loadLatestDraft(
  context: ApiReqContext,
  organizationId: string,
  featureId: string,
  mineParam: string | boolean | undefined,
) {
  const feature = await getFeature(context, featureId);
  if (!feature) throw new NotFoundError("Could not find feature");

  const mine = stringToBoolean(mineParam?.toString());
  if (mine && !context.userId) {
    throw new BadRequestError(
      "`mine=true` requires a user-scoped API key (the caller must be identifiable as a user).",
    );
  }

  const revision = await getLatestActiveDraftForFeature(
    context,
    organizationId,
    feature.id,
    feature,
    { involvedUserId: mine ? context.userId : undefined },
  );
  if (!revision) {
    throw new NotFoundError(
      mine
        ? "No active draft revision found for this feature where you are the author or a contributor"
        : "No active draft revision found for this feature",
    );
  }

  return { feature, revision };
}

export const getFeatureRevisionLatest = createApiRequestHandler(
  getFeatureRevisionLatestValidator,
)(async (req) => {
  const { feature, revision } = await loadLatestDraft(
    req.context,
    req.organization.id,
    req.params.id,
    req.query.mine,
  );
  return { revision: toApiRevision(revision, req.context, feature) };
});
