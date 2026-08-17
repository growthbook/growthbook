import { updateContextualBanditLinkedFeatureValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getFeature } from "back-end/src/models/FeatureModel";
import { updateContextualBanditFeatureRule } from "back-end/src/enterprise/services/contextualBandits";
import {
  assertValidContextualBanditVariationConfigKeys,
  assertVariationsCoverBandit,
  buildContextualBanditRefRule,
  loadContextualBanditForRead,
} from "./_shared";

export const updateContextualBanditLinkedFeature = createApiRequestHandler(
  updateContextualBanditLinkedFeatureValidator,
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

  const feature = await getFeature(req.context, req.params.featureId);
  if (!feature) {
    return req.context.throwNotFoundError(
      `Could not find a Feature Flag with id ${req.params.featureId}`,
    );
  }

  assertVariationsCoverBandit(contextualBandit, req.body.variations);
  await assertValidContextualBanditVariationConfigKeys(
    req.context,
    feature,
    req.body.variations,
    req.body.draftVersion,
  );

  const result = await updateContextualBanditFeatureRule({
    context: req.context,
    contextualBandit,
    feature,
    rule: buildContextualBanditRefRule(contextualBandit, req.body),
    eventAudit: req.eventAudit,
    audit: req.audit,
    autoPublish: req.body.autoPublish,
    draftVersion: req.body.draftVersion,
    respectApprovalFlow: true,
  });

  return {
    featureId: feature.id,
    ruleIds: result.ruleIds,
    revisionVersion: result.version,
    published: result.published,
  };
});
