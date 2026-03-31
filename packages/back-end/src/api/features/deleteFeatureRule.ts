import { cloneDeep, isEqual } from "lodash";
import { featureRequiresReview } from "shared/util";
import { ToggleFeatureResponse } from "shared/types/openapi";
import { deleteFeatureRuleValidator } from "shared/validators";
import {
  createRevision,
  getRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { getExperimentMapForFeature } from "back-end/src/models/ExperimentModel";
import { getFeature, updateFeature } from "back-end/src/models/FeatureModel";
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
  const reviewRequired = featureRequiresReview(
    feature,
    [environment],
    false,
    req.organization.settings,
  );
  if (reviewRequired) {
    if (!req.context.permissions.canBypassApprovalChecks(feature)) {
      throw new Error(
        "This feature requires a review and the API key being used does not have permission to bypass reviews.",
      );
    }
  }

  // Create a revision and publish it immediately
  const revision = await createRevision({
    context: req.context,
    feature,
    user: req.eventAudit,
    baseVersion: feature.version,
    comment: "Rule deleted via REST API",
    environments: orgEnvs,
    publish: true,
    changes: { rules: revisedRules },
    org: req.organization,
    canBypassApprovalChecks: true,
  });

  // Apply the updated rules to the feature's environmentSettings
  const updatedEnvSettings = cloneDeep(feature.environmentSettings || {});
  updatedEnvSettings[environment] = updatedEnvSettings[environment] || {};
  updatedEnvSettings[environment].rules = updatedRules;

  const updates: Record<string, unknown> = {
    version: revision.version,
  };
  if (!isEqual(updatedEnvSettings, feature.environmentSettings)) {
    updates.environmentSettings = updatedEnvSettings;
  }

  const updatedFeature = await updateFeature(req.context, feature, updates);

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
