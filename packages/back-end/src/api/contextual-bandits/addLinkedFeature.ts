import { addContextualBanditLinkedFeatureValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError } from "back-end/src/util/errors";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  linkFeatureToContextualBandit,
  targetRevisionHasContextualBanditRule,
} from "back-end/src/enterprise/services/contextualBandits";
import {
  assertValidContextualBanditVariationConfigKeys,
  assertVariationsCoverBandit,
  buildContextualBanditRefRule,
  loadContextualBanditForRead,
} from "./_shared";

export const addContextualBanditLinkedFeature = createApiRequestHandler(
  addContextualBanditLinkedFeatureValidator,
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

  const { variations, autoPublish, draftVersion } = req.body;

  const forceNewDraft = draftVersion === undefined;

  // Reject if already linked and the desired draft already has a rule for this bandit.
  if (
    contextualBandit.linkedFeatures?.includes(feature.id) &&
    (await targetRevisionHasContextualBanditRule({
      context: req.context,
      contextualBandit,
      feature,
      autoPublish,
      draftVersion,
      forceNewDraft,
    }))
  ) {
    throw new BadRequestError(
      `Feature Flag ${feature.id} already has a rule for this contextual bandit.`,
    );
  }

  assertVariationsCoverBandit(contextualBandit, variations);
  await assertValidContextualBanditVariationConfigKeys(
    req.context,
    feature,
    variations,
  );

  const result = await linkFeatureToContextualBandit({
    context: req.context,
    contextualBandit,
    feature,
    rule: buildContextualBanditRefRule(contextualBandit, req.body),
    eventAudit: req.eventAudit,
    audit: req.audit,
    autoPublish,
    draftVersion,
    forceNewDraft,
  });

  return {
    featureId: feature.id,
    ruleId: result.ruleId,
    revisionVersion: result.version,
    published: result.published,
  };
});
