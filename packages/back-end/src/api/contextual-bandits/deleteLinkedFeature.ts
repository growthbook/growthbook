import { deleteContextualBanditLinkedFeatureValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import { unlinkFeatureFromContextualBandit } from "back-end/src/enterprise/services/contextualBandits";
import { loadContextualBanditForRead } from "./_shared";

export const deleteContextualBanditLinkedFeature = createApiRequestHandler(
  deleteContextualBanditLinkedFeatureValidator,
)(async (req) => {
  const { contextualBandit } = await loadContextualBanditForRead(
    req.context,
    req.params.id,
  );

  if (
    !req.context.permissions.canUpdateContextualBandit(contextualBandit, {})
  ) {
    req.context.permissions.throwPermissionError();
  }

  // Also require feature-side edit rights — unlinking cancels a queued
  // autopublish that the feature team may be managing.
  const feature = await getFeature(req.context, req.params.featureId);
  if (feature && !req.context.permissions.canUpdateFeature(feature, {})) {
    req.context.permissions.throwPermissionError();
  }

  await unlinkFeatureFromContextualBandit(
    req.context,
    contextualBandit.id,
    req.params.featureId,
  );

  return {};
});
