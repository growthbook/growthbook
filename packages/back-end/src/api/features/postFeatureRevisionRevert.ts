import type { AuditInterfaceInput } from "shared/types/audit";
import type { EventUser } from "shared/types/events/event-types";
import type { OrganizationInterface } from "shared/types/organization";
import {
  filterEnvironmentsByFeature,
  MergeResultChanges,
  checkIfRevisionNeedsReview,
  getRulesForEnvironment,
} from "shared/util";
import { isEqual } from "lodash";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { postFeatureRevisionRevertValidator } from "shared/validators";
import type { ApiReqContext } from "back-end/types/api";
import { toApiRevision } from "back-end/src/services/features";
import { dispatchFeatureRevisionEvent } from "back-end/src/services/featureRevisionEvents";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
} from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  createRevision,
  getRevision,
} from "back-end/src/models/FeatureRevisionModel";
import {
  createAndPublishRevision,
  getFeature,
} from "back-end/src/models/FeatureModel";
import { addTagsDiff } from "back-end/src/models/TagModel";
import { getEnvironments } from "back-end/src/services/organizations";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";
import { canUseRestApiBypassSetting } from "./reviewBypass";

export async function revertFeatureRevision(
  context: ApiReqContext,
  organization: OrganizationInterface,
  eventAudit: EventUser,
  params: { id: string; version: number },
  body: {
    strategy?: "draft" | "publish";
    comment?: string;
    title?: string;
  },
  audit: (input: AuditInterfaceInput) => Promise<void>,
  canUseRestApiBypass: boolean,
) {
  const feature = await getFeature(context, params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  if (!context.permissions.canUpdateFeature(feature, {})) {
    context.permissions.throwPermissionError();
  }

  const { strategy = "draft", comment, title } = body;
  // Publish perms only apply to strategy: "publish"; the draft branch is
  // gated by canManageFeatureDrafts below.
  const isPublish = strategy === "publish";

  const targetRevision = await getRevision({
    context,
    organization: organization.id,
    featureId: feature.id,
    feature,
    version: params.version,
  });
  if (!targetRevision)
    throw new NotFoundError("Could not find feature revision");

  if (targetRevision.status !== "published") {
    throw new BadRequestError(
      "Can only revert to a published revision. " +
        `Revision #${params.version} has status "${targetRevision.status}".`,
    );
  }
  if (targetRevision.version === feature.version) {
    throw new BadRequestError(
      `Revision #${params.version} is already the live version — nothing to revert.`,
    );
  }

  // Build the delta between the target revision and current live state.
  const allEnvironments = getEnvironments(context.org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const environmentIds = environments.map((e) => e.id);

  const changes: MergeResultChanges = {};

  if (targetRevision.defaultValue !== feature.defaultValue) {
    if (
      isPublish &&
      !context.permissions.canPublishFeature(
        feature,
        environmentIds.filter(
          (env) => feature.environmentSettings?.[env]?.enabled,
        ),
      )
    ) {
      context.permissions.throwPermissionError();
    }
    changes.defaultValue = targetRevision.defaultValue;
  }

  const changedEnvs: string[] = [];
  // v2: rules live on a single flat array. Diff per-env via projection to
  // preserve the UX of "which envs' rule lists would change" for permission
  // checks, but persist the change at the whole-array level below.
  const targetRulesFlat = targetRevision.rules ?? feature.rules ?? [];
  const currentRulesFlat = feature.rules ?? [];
  let anyRulesChanged = false;
  environmentIds.forEach((env) => {
    const currentRules = getRulesForEnvironment(currentRulesFlat, env);
    const targetRules = getRulesForEnvironment(targetRulesFlat, env);
    if (!isEqual(targetRules, currentRules)) {
      changedEnvs.push(env);
      anyRulesChanged = true;
    }

    if (
      targetRevision.environmentsEnabled &&
      env in targetRevision.environmentsEnabled &&
      targetRevision.environmentsEnabled[env] !==
        feature.environmentSettings?.[env]?.enabled
    ) {
      changes.environmentsEnabled = changes.environmentsEnabled || {};
      changes.environmentsEnabled[env] =
        targetRevision.environmentsEnabled[env];
      if (!changedEnvs.includes(env)) changedEnvs.push(env);
    }
  });
  if (anyRulesChanged) {
    changes.rules = targetRulesFlat;
  }

  if (isPublish && changedEnvs.length > 0) {
    if (!context.permissions.canPublishFeature(feature, changedEnvs)) {
      context.permissions.throwPermissionError();
    }
  }

  const allEnabledEnvs = environmentIds.filter(
    (env) => feature.environmentSettings?.[env]?.enabled,
  );

  if (
    targetRevision.prerequisites !== undefined &&
    !isEqual(targetRevision.prerequisites, feature.prerequisites || [])
  ) {
    if (
      isPublish &&
      !context.permissions.canPublishFeature(feature, allEnabledEnvs)
    ) {
      context.permissions.throwPermissionError();
    }
    changes.prerequisites = targetRevision.prerequisites;
  }

  // Sparse: only revert archived if this revision explicitly changed it.
  if (
    targetRevision.archived !== undefined &&
    targetRevision.archived !== (feature.archived ?? false)
  ) {
    if (
      isPublish &&
      !context.permissions.canPublishFeature(feature, allEnabledEnvs)
    ) {
      context.permissions.throwPermissionError();
    }
    changes.archived = targetRevision.archived;
  }

  if (targetRevision.metadata) {
    const m = targetRevision.metadata;
    const metadataChanges: typeof changes.metadata = {};
    let hasMetaChange = false;
    if (
      m.description !== undefined &&
      m.description !== (feature.description ?? "")
    ) {
      metadataChanges.description = m.description;
      hasMetaChange = true;
    }
    if (m.owner !== undefined && m.owner !== (feature.owner ?? "")) {
      metadataChanges.owner = m.owner;
      hasMetaChange = true;
    }
    if (m.project !== undefined && m.project !== (feature.project ?? "")) {
      metadataChanges.project = m.project;
      hasMetaChange = true;
    }
    if (m.tags !== undefined && !isEqual(m.tags, feature.tags ?? [])) {
      metadataChanges.tags = m.tags;
      hasMetaChange = true;
    }
    if (m.neverStale !== undefined && m.neverStale !== feature.neverStale) {
      metadataChanges.neverStale = m.neverStale;
      hasMetaChange = true;
    }
    if (
      m.customFields !== undefined &&
      !isEqual(m.customFields, feature.customFields ?? {})
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
        isPublish &&
        !context.permissions.canPublishFeature(feature, allEnabledEnvs)
      ) {
        context.permissions.throwPermissionError();
      }
      changes.metadata = metadataChanges;
    }
  }

  // Full target state for the new revision; sparse `changes` above is only
  // used for per-field permission checks.
  const revisionChanges: Partial<FeatureRevisionInterface> = {
    defaultValue: targetRevision.defaultValue,
    rules: targetRevision.rules ?? feature.rules ?? [],
  };
  if (targetRevision.environmentsEnabled !== undefined) {
    revisionChanges.environmentsEnabled = targetRevision.environmentsEnabled;
  }
  if (targetRevision.prerequisites !== undefined) {
    revisionChanges.prerequisites = targetRevision.prerequisites;
  }
  if (targetRevision.archived !== undefined) {
    revisionChanges.archived = targetRevision.archived;
  }
  if (targetRevision.metadata !== undefined) {
    revisionChanges.metadata = targetRevision.metadata;
  }

  const defaultComment = `Revert to revision #${targetRevision.version}`;

  if (!isPublish) {
    if (!context.permissions.canManageFeatureDrafts(feature)) {
      context.permissions.throwPermissionError();
    }

    const newDraft = await createRevision({
      context,
      feature,
      user: context.auditUser,
      baseVersion: feature.version,
      comment: comment ?? defaultComment,
      title: title ?? `Revert to v${targetRevision.version}`,
      environments: getEnvironmentIdsFromOrg(context.org),
      publish: false,
      changes: revisionChanges,
      org: context.org,
      canBypassApprovalChecks: false,
    });

    return { feature, revision: newDraft };
  }

  // Bypass via restApiBypassesReviews (API keys/PATs only — JWT-backed REST
  // calls should behave like dashboard actions) or bypassApprovalChecks.
  const canBypass =
    canUseRestApiBypass || context.permissions.canBypassApprovalChecks(feature);

  if (!canBypass) {
    const liveRevision = await getRevision({
      context,
      organization: feature.organization,
      featureId: feature.id,
      feature,
      version: feature.version,
    });
    if (!liveRevision)
      throw new InternalServerError("Could not load live revision");

    const allEnvironmentIds = getEnvironmentIdsFromOrg(context.org);
    const requiresReview = checkIfRevisionNeedsReview({
      feature,
      baseRevision: liveRevision,
      revision: { ...liveRevision, ...revisionChanges } as typeof liveRevision,
      allEnvironments: allEnvironmentIds,
      settings: organization.settings,
      requireApprovalsLicensed: context.hasPremiumFeature("require-approvals"),
    });

    if (requiresReview) {
      throw new BadRequestError(
        "This revert requires approval before changes can be published. " +
          "Enable 'REST API always bypasses approval requirements' in organization settings, " +
          "or use a role/token that grants bypassApprovalChecks on this project.",
      );
    }
  }

  const { revision: publishedRevision, updatedFeature } =
    await createAndPublishRevision({
      context,
      feature,
      user: eventAudit,
      org: organization,
      changes: revisionChanges,
      comment: comment ?? defaultComment,
      canBypassApprovalChecks: canBypass,
    });

  if (
    revisionChanges.metadata?.tags !== undefined &&
    Array.isArray(revisionChanges.metadata.tags)
  ) {
    await addTagsDiff(
      organization.id,
      feature.tags || [],
      revisionChanges.metadata.tags,
    );
  }

  await audit({
    event: "feature.revert",
    entity: {
      object: "feature",
      id: feature.id,
    },
    details: auditDetailsUpdate(feature, updatedFeature, {
      revision: publishedRevision.version,
      revertedTo: targetRevision.version,
    }),
  });

  const updated = await getRevision({
    context,
    organization: organization.id,
    featureId: feature.id,
    feature,
    version: publishedRevision.version,
  });
  const finalRevision = updated ?? publishedRevision;

  await dispatchFeatureRevisionEvent(
    context,
    updatedFeature,
    finalRevision,
    "revision.reverted",
    { revertedToVersion: targetRevision.version },
  );

  return { feature, revision: finalRevision };
}

export const postFeatureRevisionRevert = createApiRequestHandler(
  postFeatureRevisionRevertValidator,
)(async (req) => {
  const { feature, revision } = await revertFeatureRevision(
    req.context,
    req.organization,
    req.eventAudit,
    req.params,
    req.body,
    req.audit,
    canUseRestApiBypassSetting(req),
  );
  return { revision: toApiRevision(revision, req.context, feature) };
});
