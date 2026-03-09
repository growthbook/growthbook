import { ToggleFeatureResponse } from "shared/types/openapi";
import { toggleFeatureValidator } from "shared/validators";
import { getReviewSetting } from "shared/util";
import {
  createRevision,
  getRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { getExperimentMapForFeature } from "back-end/src/models/ExperimentModel";
import {
  applyRevisionChanges,
  getFeature,
  toggleMultipleEnvironments,
} from "back-end/src/models/FeatureModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import {
  getApiFeatureObj,
  getSavedGroupMap,
} from "back-end/src/services/features";
import { getEnvironmentIdsFromOrg } from "back-end/src/services/organizations";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const toggleFeature = createApiRequestHandler(toggleFeatureValidator)(
  async (req): Promise<ToggleFeatureResponse> => {
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

    const requireReviewsSettings = Array.isArray(
      req.context.org.settings?.requireReviews,
    )
      ? req.context.org.settings.requireReviews
      : [];
    const reviewSettingForToggle = getReviewSetting(
      requireReviewsSettings,
      feature,
    );
    const envReviewRequired =
      !!reviewSettingForToggle?.requireReviewOn &&
      !!reviewSettingForToggle?.featureRequireEnvironmentReview;
    const apiBypassesReviews =
      req.context.org.settings?.restApiBypassesReviews !== false;

    if (envReviewRequired) {
      // Determine which envs actually changed
      const changedToggles: Record<string, boolean> = {};
      for (const [env, state] of Object.entries(toggles)) {
        if (feature.environmentSettings?.[env]?.enabled !== state) {
          changedToggles[env] = state;
        }
      }

      if (Object.keys(changedToggles).length > 0) {
        if (
          !apiBypassesReviews &&
          !req.context.permissions.canBypassApprovalChecks(feature)
        ) {
          throw new Error(
            "This feature requires a review for kill switch changes and the API key being used does not have permission to bypass reviews.",
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
          canBypassApprovalChecks: apiBypassesReviews,
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
      }
    }

    // "off" or "warn" behavior: direct write (same as legacy behavior)
    const updatedFeature = await toggleMultipleEnvironments(
      req.context,
      feature,
      toggles,
    );

    if (updatedFeature !== feature) {
      await req.audit({
        event: "feature.toggle",
        entity: {
          object: "feature",
          id: feature.id,
        },
        details: auditDetailsUpdate(feature, updatedFeature),
        reason: req.body.reason,
      });
    }

    const groupMap = await getSavedGroupMap(req.context);
    const experimentMap = await getExperimentMapForFeature(
      req.context,
      updatedFeature.id,
    );
    const revision = await getRevision({
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
        revision,
        safeRolloutMap,
      }),
    };
  },
);
