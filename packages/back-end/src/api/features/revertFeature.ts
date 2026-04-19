import {
  filterEnvironmentsByFeature,
  MergeResultChanges,
  PermissionError,
  checkIfRevisionNeedsReview,
} from "shared/util";
import { isEqual } from "lodash";
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
import { NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getEnabledEnvironments } from "back-end/src/util/features";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";

export const revertFeature = createApiRequestHandler(revertFeatureValidator)(
  async (req) => {
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
      throw new NotFoundError("Could not find feature revision");
    }

    if (
      revision.version === feature.version ||
      revision.status !== "published"
    ) {
      throw new Error("Can only revert to previously published revisions");
    }

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

    // Populate all envs so createRevision doesn't default missing ones to [].
    changes.rules = {};
    const changedEnvs: string[] = [];
    environmentIds.forEach((env) => {
      const currentRules = feature.environmentSettings?.[env]?.rules || [];
      // Missing env in target revision → preserve current state.
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

    // Bypass via restApiBypassesReviews or bypassApprovalChecks.
    const canBypass =
      !!req.context.org.settings?.restApiBypassesReviews ||
      req.context.permissions.canBypassApprovalChecks(feature);

    if (!canBypass) {
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
        revision: { ...liveRevision, ...changes } as typeof liveRevision,
        allEnvironments: allEnvironmentIds,
        settings: req.organization.settings,
        requireApprovalsLicensed:
          req.context.hasPremiumFeature("require-approvals"),
      });
      if (reviewRequired) {
        throw new PermissionError(
          "This revert requires approval before changes can be published. " +
            "Enable 'REST API always bypasses approval requirements' in organization settings, " +
            "or use a role/token that grants bypassApprovalChecks on this project.",
        );
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
        canBypassApprovalChecks: canBypass,
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
