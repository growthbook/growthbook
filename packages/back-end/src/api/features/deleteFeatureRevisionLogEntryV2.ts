import { deleteFeatureRevisionLogEntryV2Validator } from "shared/validators";
import { NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";

export const deleteFeatureRevisionLogEntryV2 = createApiRequestHandler(
  deleteFeatureRevisionLogEntryV2Validator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  // Author-of-entry is enforced by the model's canDelete; nothing further to
  // gate at the controller level beyond confirming the feature exists.
  await req.context.models.featureRevisionLogs.deleteOwnedEntry(
    req.params.logId,
  );

  return { status: 200 as const };
});
