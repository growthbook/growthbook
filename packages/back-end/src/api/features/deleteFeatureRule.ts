import { checkIfRevisionNeedsReview, PermissionError } from "shared/util";
import { ToggleFeatureResponse } from "shared/types/openapi";
import { deleteFeatureRuleValidator } from "shared/validators";
import {
  createRevision,
  getRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { getExperimentMapForFeature } from "back-end/src/models/ExperimentModel";
import {
  applyRevisionChanges,
  getFeature,
} from "back-end/src/models/FeatureModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import {
  getApiFeatureObj,
  getSavedGroupMap,
} from "back-end/src/services/features";
import { getEnvironmentIdsFromOrg } from "back-end/src/services/organizations";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const deleteFeatureRule = createApiRequestHandler(
  deleteFeatureRuleValidator,
)(async (req): Promise<ToggleFeatureResponse> => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) {
    throw new Error("Could not find a feature with that key");
  }

  const { environment, ruleId } = req.body;

  const orgEnvs = getEnvironmentIdsFromOrg(req.organization);
  if (!orgEnvs.includes(environment)) {
    throw new Error(`Unknown environment: '${environment}'`);
  }

  if (!req.context.permissions.canUpdateFeature(feature, {})) {
    req.context.permissions.throwPermissionError();
  }
  if (!req.context.permissions.canPublishFeature(feature, [environment])) {
    req.context.permissions.throwPermissionError();
  }

  const rules = feature.environmentSettings?.[environment]?.rules || [];
  const ruleIndex = rules.findIndex((r) => r.id === ruleId);
  if (ruleIndex === -1) {
    throw new Error(
      `Rule with id '${ruleId}' not found in environment '${environment}'`,
    );
  }

  // Build the new rules array with the target rule removed
  const updatedRules = rules.slice();
  updatedRules.splice(ruleIndex, 1);

  // Build revision changes: copy current rules for all envs, apply the deletion
  const revisedRules: Record<string, typeof rules> = {};
  Object.entries(feature.environmentSettings || {}).forEach(
    ([env, settings]) => {
      revisedRules[env] = settings.rules || [];
    },
  );
  revisedRules[environment] = updatedRules;

  // Check if review is required for this change
  const apiBypassesReviews = !!req.context.org.settings?.restApiBypassesReviews;

  if (!apiBypassesReviews) {
    const liveRevision = await getRevision({
      context: req.context,
      organization: feature.organization,
      featureId: feature.id,
      version: feature.version,
    });
    if (!liveRevision) {
      throw new Error("Could not load live revision for feature");
    }
    const fakeRevision = {
      ...liveRevision,
      rules: revisedRules,
    };
    const reviewRequired = checkIfRevisionNeedsReview({
      feature,
      baseRevision: liveRevision,
      revision: fakeRevision,
      allEnvironments: orgEnvs,
      settings: req.organization.settings,
      requireApprovalsLicensed:
        req.context.hasPremiumFeature("require-approvals"),
    });
    if (reviewRequired) {
      throw new PermissionError(
        "This feature requires a review before publishing changes. " +
          "Enable 'REST API always bypasses approval requirements' in organization settings.",
      );
    }
  }

  // Create a revision and publish it immediately
  const changes = { rules: revisedRules };
  const revision = await createRevision({
    context: req.context,
    feature,
    user: req.eventAudit,
    baseVersion: feature.version,
    comment: "Rule deleted via REST API",
    environments: orgEnvs,
    publish: true,
    changes,
    org: req.organization,
    canBypassApprovalChecks: true, // review gate already enforced above
  });

  // Apply revision changes (handles nextScheduledUpdate, safe rollout cleanup, etc.)
  const updatedFeature = await applyRevisionChanges(
    req.context,
    feature,
    revision,
    changes,
  );

  await req.audit({
    event: "feature.update",
    entity: {
      object: "feature",
      id: feature.id,
    },
    details: auditDetailsUpdate(feature, updatedFeature),
  });

  const groupMap = await getSavedGroupMap(req.context);
  const experimentMap = await getExperimentMapForFeature(
    req.context,
    feature.id,
  );
  const latestRevision = await getRevision({
    context: req.context,
    organization: updatedFeature.organization,
    featureId: updatedFeature.id,
    version: updatedFeature.version,
  });
  const safeRolloutMap =
    await req.context.models.safeRollout.getAllPayloadSafeRollouts();

  return {
    feature: getApiFeatureObj({
      feature: updatedFeature,
      organization: req.organization,
      groupMap,
      experimentMap,
      revision: latestRevision,
      safeRolloutMap,
    }),
  };
});
