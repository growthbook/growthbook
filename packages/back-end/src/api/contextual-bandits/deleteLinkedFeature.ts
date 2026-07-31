import { deleteContextualBanditLinkedFeatureValidator } from "shared/validators";
import { stringToBoolean } from "shared/util";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import { unlinkFeatureFromContextualBandit } from "back-end/src/enterprise/services/contextualBandits";
import { NotFoundError } from "back-end/src/util/errors";
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

  // Also require feature-side edit rights — unlinking strips the rule off the
  // feature and cancels a queued autopublish the feature team may be managing.
  const feature = await getFeature(req.context, req.params.featureId);
  if (feature && !req.context.permissions.canUpdateFeature(feature, {})) {
    req.context.permissions.throwPermissionError();
  }
  if (!feature) {
    // While we would like to remove the linkage if the feature is linked but doesn't exist
    // we can't leak that a feature exists but a user doesn't have permission to read it by
    // then unlinking it only in this case, so we throw early
    throw new NotFoundError("Feature not found");
  }

  const result = await unlinkFeatureFromContextualBandit({
    context: req.context,
    contextualBandit,
    featureId: req.params.featureId,
    feature,
    eventAudit: req.eventAudit,
    audit: req.audit,
    autoPublish: stringToBoolean(req.query.autoPublish?.toString()),
  });

  return {
    featureId: req.params.featureId,
    removedRuleIds: result.removedRuleIds,
    revisionVersion: result.revisionVersion,
    published: result.published,
  };
});
