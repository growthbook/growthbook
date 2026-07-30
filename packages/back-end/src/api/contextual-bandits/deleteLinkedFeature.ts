import { deleteContextualBanditLinkedFeatureValidator } from "shared/validators";
import { stringToBoolean } from "shared/util";
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

  // Also require feature-side edit rights — unlinking strips the rule off the
  // feature and cancels a queued autopublish the feature team may be managing.
  const feature = await getFeature(req.context, req.params.featureId);
  if (feature && !req.context.permissions.canUpdateFeature(feature, {})) {
    req.context.permissions.throwPermissionError();
  }

  const result = await unlinkFeatureFromContextualBandit({
    context: req.context,
    contextualBandit,
    featureId: req.params.featureId,
    feature,
    eventAudit: req.eventAudit,
    audit: req.audit,
    autoPublish: stringToBoolean(req.query.autoPublish?.toString()),
    draftVersion: req.query.draftVersion,
  });

  return {
    featureId: req.params.featureId,
    removedRuleIds: result.removedRuleIds,
    revisionVersion: result.revisionVersion,
    published: result.published,
  };
});
