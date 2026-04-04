import {
  filterEnvironmentsByFeature,
  MergeResultChanges,
  PermissionError,
  checkIfRevisionNeedsReview,
} from "shared/util";
import { isEqual } from "lodash";
import { ToggleFeatureResponse } from "shared/types/openapi";
import { revertFeatureValidator } from "shared/validators";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { getExperimentMapForFeature } from "back-end/src/models/ExperimentModel";
import {
  createAndPublishRevision,
  getFeature,
} from "back-end/src/models/FeatureModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import {
  getApiFeatureObj,
  getSavedGroupMap,
} from "back-end/src/services/features";
import { getEnvironments } from "back-end/src/services/organizations";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getEnabledEnvironments } from "back-end/src/util/features";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";

export const revertFeature = createApiRequestHandler(revertFeatureValidator)(
  async (req): Promise<ToggleFeatureResponse> => {
    const context = req.context;

    const feature = await getFeature(context, req.params.id);
    if (!feature) {
      throw new Error("Could not find a feature with that key");
    }

    const allEnvironments = getEnvironments(context.org);
    const environments = filterEnvironmentsByFeature(allEnvironments, feature);
    const environmentIds = environments.map((e) => e.id);
    const allEnvironmentIds = getEnvironmentIdsFromOrg(req.organization);

    if (!req.context.permissions.canUpdateFeature(feature, {})) {
      req.context.permissions.throwPermissionError();
    }

    const { revision: version, comment } = req.body;

    const revision = await getRevision({
      context,
      organization: context.org.id,
      featureId: feature.id,
      version: version,
    });
    if (!revision) {
      throw new Error("Could not find feature revision");
    }

    if (
      revision.version === feature.version ||
      revision.status !== "published"
    ) {
      throw new Error("Can only revert to previously published revisions");
    }

    // Build the set of changes this revert would apply.
    const changes: MergeResultChanges = {};

    if (revision.defaultValue !== feature.defaultValue) {
      if (
        !context.permissions.canPublishFeature(
          feature,
          Array.from(getEnabledEnvironments(feature, environmentIds)),
        )
      ) {
        context.permissions.throwPermissionError();
      }
      changes.defaultValue = revision.defaultValue;
    }

    // Always write all envs into changes.rules so createRevision doesn't
    // fall back to [] for any env absent from a sparse map.
    changes.rules = {};
    const changedEnvs: string[] = [];
    environmentIds.forEach((env) => {
      const currentRules = feature.environmentSettings?.[env]?.rules || [];
      // If the target revision has rules for this env, restore them;
      // otherwise preserve current state (env didn't exist at revision time).
      const targetRules =
        revision.rules && env in revision.rules
          ? revision.rules[env]
          : currentRules;
      changes.rules![env] = targetRules;
      if (!isEqual(targetRules, currentRules)) {
        changedEnvs.push(env);
      }

      if (
        revision.environmentsEnabled &&
        env in revision.environmentsEnabled &&
        revision.environmentsEnabled[env] !==
          feature.environmentSettings?.[env]?.enabled
      ) {
        changes.environmentsEnabled = changes.environmentsEnabled || {};
        changes.environmentsEnabled[env] = revision.environmentsEnabled[env];
        if (!changedEnvs.includes(env)) changedEnvs.push(env);
      }
    });

    if (changedEnvs.length > 0) {
      if (!context.permissions.canPublishFeature(feature, changedEnvs)) {
        context.permissions.throwPermissionError();
      }
    }

    if (
      revision.prerequisites !== undefined &&
      !isEqual(revision.prerequisites, feature.prerequisites || [])
    ) {
      if (
        !context.permissions.canPublishFeature(
          feature,
          Array.from(getEnabledEnvironments(feature, environmentIds)),
        )
      ) {
        context.permissions.throwPermissionError();
      }
      changes.prerequisites = revision.prerequisites;
    }

    if (revision.metadata) {
      const metadataChanges: typeof changes.metadata = {};
      let hasMetaChange = false;
      const m = revision.metadata;
      if (
        m.description !== undefined &&
        m.description !== feature.description
      ) {
        metadataChanges.description = m.description;
        hasMetaChange = true;
      }
      if (m.owner !== undefined && m.owner !== feature.owner) {
        metadataChanges.owner = m.owner;
        hasMetaChange = true;
      }
      if (m.project !== undefined && m.project !== feature.project) {
        metadataChanges.project = m.project;
        hasMetaChange = true;
      }
      if (m.tags !== undefined && !isEqual(m.tags, feature.tags)) {
        metadataChanges.tags = m.tags;
        hasMetaChange = true;
      }
      if (m.neverStale !== undefined && m.neverStale !== feature.neverStale) {
        metadataChanges.neverStale = m.neverStale;
        hasMetaChange = true;
      }
      if (
        m.customFields !== undefined &&
        !isEqual(m.customFields, feature.customFields)
      ) {
        metadataChanges.customFields = m.customFields;
        hasMetaChange = true;
      }
      if (
        m.jsonSchema !== undefined &&
        !isEqual(m.jsonSchema, feature.jsonSchema)
      ) {
        metadataChanges.jsonSchema = m.jsonSchema;
        hasMetaChange = true;
      }
      if (m.valueType !== undefined && m.valueType !== feature.valueType) {
        metadataChanges.valueType = m.valueType;
        hasMetaChange = true;
      }
      if (hasMetaChange) {
        if (
          !context.permissions.canPublishFeature(
            feature,
            Array.from(getEnabledEnvironments(feature, environmentIds)),
          )
        ) {
          context.permissions.throwPermissionError();
        }
        changes.metadata = metadataChanges;
      }
    }

    const adminOverride = !!req.body.adminOverride;
    const apiBypassesReviews =
      !!req.context.org.settings?.restApiBypassesReviews;

    const liveRevision = await getRevision({
      context,
      organization: feature.organization,
      featureId: feature.id,
      version: feature.version,
    });
    if (!liveRevision) {
      throw new Error("Could not load live revision for feature");
    }

    const reviewRequired = checkIfRevisionNeedsReview({
      feature,
      baseRevision: liveRevision,
      revision,
      allEnvironments: allEnvironmentIds,
      settings: req.organization.settings,
      requireApprovalsLicensed:
        req.context.hasPremiumFeature("require-approvals"),
    });

    if (reviewRequired) {
      if (!adminOverride) {
        throw new PermissionError(
          "This revert requires approval before changes can be published. " +
            "Pass adminOverride: true if your organization allows REST API bypass.",
        );
      }
      if (!apiBypassesReviews) {
        throw new PermissionError(
          "Cannot use adminOverride: your organization has not enabled 'REST API always bypasses approval requirements'.",
        );
      }
      if (!req.context.permissions.canBypassApprovalChecks(feature)) {
        req.context.permissions.throwPermissionError();
      }
    }

    const { revision: newRevision, updatedFeature } =
      await createAndPublishRevision({
        context,
        feature,
        user: req.eventAudit,
        org: req.organization,
        changes,
        comment: comment ?? `Reverted to revision #${version}`,
        canBypassApprovalChecks: adminOverride && apiBypassesReviews,
      });

    await req.audit({
      event: "feature.revert",
      entity: {
        object: "feature",
        id: feature.id,
      },
      details: auditDetailsUpdate(feature, updatedFeature, {
        revision: newRevision.version,
      }),
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
  },
);
