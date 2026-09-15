import { putFeatureRevisionLogCommentV2Validator } from "shared/validators";
import { NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";

export const putFeatureRevisionLogCommentV2 = createApiRequestHandler(
  putFeatureRevisionLogCommentV2Validator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  // Author-of-entry is enforced by the model's canUpdate; the model also
  // verifies the entry belongs to the feature+version in the URL.
  await req.context.models.featureRevisionLogs.updateCommentText(
    req.params.logId,
    req.body.comment,
    { featureId: feature.id, version: req.params.version },
  );

  return { status: 200 as const };
});
