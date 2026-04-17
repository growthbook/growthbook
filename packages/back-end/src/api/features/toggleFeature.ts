import { toggleFeatureValidator } from "shared/validators";
import {
  checkIfRevisionNeedsReview,
  getDraftAffectedEnvironments,
  PermissionError,
} from "shared/util";
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

export const toggleFeature = createApiRequestHandler(toggleFeatureValidator)(
  async (req) => {
    const feature = await getFeature(req.context, req.params.id);
    if (!feature) {
      throw new Error("Could not find a feature with that key");
    }

    const environmentIds = getEnvironmentIdsFromOrg(req.organization);

    if (
      !req.context.permissions.canUpdateFeature(feature, {}) ||
      !req.context.permissions.canPublishFeature(
        feature,
        Object.keys(req.body.environments),
      )
    ) {
      req.context.permissions.throwPermissionError();
    }

    const toggles: Record<string, boolean> = {};
    Object.keys(req.body.environments).forEach((env) => {
      if (!environmentIds.includes(env)) {
        throw new Error(`Unknown environment: '${env}'`);
      }
      const state = [true, "true", "1", 1].includes(req.body.environments[env]);
      toggles[env] = state;
    });

    // Determine which envs actually changed
    const changedToggles: Record<string, boolean> = {};
    for (const [env, state] of Object.entries(toggles)) {
      if (feature.environmentSettings?.[env]?.enabled !== state) {
        changedToggles[env] = state;
      }
    }

    if (Object.keys(changedToggles).length === 0) {
      // No changes — return current state
      const groupMap = await getSavedGroupMap(req.context);
      const experimentMap = await getExperimentMapForFeature(
        req.context,
        feature.id,
      );
      const revision = await getRevision({
        context: req.context,
        organization: feature.organization,
        featureId: feature.id,
        version: feature.version,
      });
      const safeRolloutMap =
        await req.context.models.safeRollout.getAllPayloadSafeRollouts();
      return {
        feature: getApiFeatureObj({
          feature,
          organization: req.organization,
          groupMap,
          experimentMap,
          revision,
          safeRolloutMap,
        }),
      };
    }

    // Callers bypass the review gate via either the org-level
    // restApiBypassesReviews setting or a role/token that grants the
    // bypassApprovalChecks permission on this feature's project.
    const canBypass =
      !!req.context.org.settings?.restApiBypassesReviews ||
      req.context.permissions.canBypassApprovalChecks(feature);
    // Build a minimal fake revision to check whether these toggle changes need review
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
      environmentsEnabled: changedToggles,
    };
    const reviewRequired = checkIfRevisionNeedsReview({
      feature,
      baseRevision: liveRevision,
      revision: fakeRevision,
      allEnvironments: environmentIds,
      settings: req.organization.settings,
      requireApprovalsLicensed:
        req.context.hasPremiumFeature("require-approvals"),
    });

    if (reviewRequired && !canBypass) {
      const affectedEnvs = getDraftAffectedEnvironments(
        fakeRevision,
        liveRevision,
        environmentIds,
      );
      const envList =
        affectedEnvs === "all" ? "all environments" : affectedEnvs.join(", ");
      throw new PermissionError(
        `This feature requires a review before publishing changes to: ${envList}. ` +
          "Enable 'REST API always bypasses approval requirements' in organization settings, " +
          "or use a role/token that grants bypassApprovalChecks on this project.",
      );
    }

    const revision = await createRevision({
      context: req.context,
      feature,
      user: req.eventAudit,
      baseVersion: feature.version,
      comment: "Created via REST API",
      environments: environmentIds,
      publish: true,
      changes: { environmentsEnabled: changedToggles },
      org: req.organization,
      canBypassApprovalChecks: true, // review gate enforced above
    });

    const updatedFeature = await applyRevisionChanges(
      req.context,
      feature,
      revision,
      { environmentsEnabled: changedToggles },
    );

    await req.audit({
      event: "feature.toggle",
      entity: { object: "feature", id: feature.id },
      details: auditDetailsUpdate(feature, updatedFeature),
      reason: req.body.reason,
    });

    const groupMap = await getSavedGroupMap(req.context);
    const experimentMap = await getExperimentMapForFeature(
      req.context,
      updatedFeature.id,
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
  },
);
