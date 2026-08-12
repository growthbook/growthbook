import {
  metadataTouchesPayload,
  holdsMoveDestination,
  NO_ENVIRONMENT_BINDING,
} from "shared/permissions";
import type { AuditInterfaceInput } from "shared/types/audit";
import type { EventUser } from "shared/types/events/event-types";
import type { OrganizationInterface } from "shared/types/organization";
import {
  filterEnvironmentsByFeature,
  MergeResultChanges,
  PermissionError,
  checkIfRevisionNeedsReview,
  getRevertTargetHoldout,
  getRevertValueValidationWarnings,
  getRulesForEnvironment,
} from "shared/util";
import { isEqual } from "lodash";
import { revertFeatureValidator } from "shared/validators";
import { revertFootprint } from "back-end/src/revisions/featureDraftAuthority";
import type { BypassedGate } from "back-end/src/revisions/publishGates";
import type { ApiReqContext } from "back-end/types/api";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { getExperimentMapForFeature } from "back-end/src/models/ExperimentModel";
import {
  createAndPublishRevision,
  getFeature,
} from "back-end/src/models/FeatureModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import {
  dispatchFeatureRevisionEvent,
  getPublishedRevisionForEvents,
} from "back-end/src/services/featureRevisionEvents";
import {
  getApiFeatureObj,
  getSavedGroupMap,
} from "back-end/src/services/features";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { getEnvironments } from "back-end/src/services/organizations";
import { NotFoundError, SoftWarningError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getEnabledEnvironments } from "back-end/src/util/features";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";
import { assertValidHoldout } from "./v2Shared";
import { canUseRestApiBypassSetting } from "./reviewBypass";

export async function revertFeatureCore(
  context: ApiReqContext,
  organization: OrganizationInterface,
  eventAudit: EventUser,
  params: { id: string },
  body: { revision: number; comment?: string },
  audit: (input: AuditInterfaceInput) => Promise<void>,
  canUseRestApiBypass: boolean,
) {
  const feature = await getFeature(context, params.id);
  if (!feature) {
    throw new Error("Could not find a feature with that key");
  }

  const allEnvironments = getEnvironments(context.org);
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const environmentIds = environments.map((e) => e.id);
  const allEnvironmentIds = getEnvironmentIdsFromOrg(organization);

  // Prevent metadata-only reverts from bypassing the project-scoped check.
  if (!context.permissions.canRevertFeature(feature, NO_ENVIRONMENT_BINDING)) {
    context.permissions.throwPermissionError();
  }

  const { revision: version, comment } = body;

  const revision = await getRevision({
    context,
    organization: context.org.id,
    featureId: feature.id,
    feature,
    version: version,
  });
  if (!revision) {
    throw new NotFoundError("Could not find feature revision");
  }

  if (revision.version === feature.version || revision.status !== "published") {
    throw new Error("Can only revert to previously published revisions");
  }

  const changes: MergeResultChanges = {};

  if (revision.defaultValue !== feature.defaultValue) {
    if (
      !context.permissions.canRevertFeature(
        feature,
        Array.from(getEnabledEnvironments(feature, environmentIds)),
      )
    ) {
      context.permissions.throwPermissionError();
    }
    changes.defaultValue = revision.defaultValue;
  }

  // v2: rules are a single flat array on the revision/feature. Project
  // per-env only to compute which envs' rule lists effectively changed for
  // permission gating; persist the whole flat array.
  const targetRulesFlat = revision.rules ?? feature.rules ?? [];
  const currentRulesFlat = feature.rules ?? [];
  const changedEnvs: string[] = [];
  let anyRulesChanged = false;
  environmentIds.forEach((env) => {
    const currentRules = getRulesForEnvironment(currentRulesFlat, env);
    const targetRules = getRulesForEnvironment(targetRulesFlat, env);
    if (!isEqual(targetRules, currentRules)) {
      changedEnvs.push(env);
      anyRulesChanged = true;
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
  if (anyRulesChanged) {
    changes.rules = targetRulesFlat;
  }

  if (changedEnvs.length > 0) {
    if (!context.permissions.canRevertFeature(feature, changedEnvs)) {
      context.permissions.throwPermissionError();
    }
  }

  if (
    revision.prerequisites !== undefined &&
    !isEqual(revision.prerequisites, feature.prerequisites || [])
  ) {
    if (
      !context.permissions.canRevertFeature(
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
    if (m.description !== undefined && m.description !== feature.description) {
      metadataChanges.description = m.description;
      hasMetaChange = true;
    }
    if (m.owner !== undefined && m.owner !== feature.owner) {
      metadataChanges.owner = m.owner;
      hasMetaChange = true;
    }
    if (m.project !== undefined && m.project !== feature.project) {
      // A move has to land where the caller has authority, not just leave where
      // they do — this path publishes directly, bypassing the publish engine's
      // destination check. The footprint comes from revertFootprint, which unions
      // what the flag serves now with what the restore would switch on or rewrite.
      //
      // REVERT, not publish: restoring a published state is what the revert atom is
      // for, and the generic engine gates the same move the same way. Asking for
      // publish here meant a revert-only role could restore everything about a
      // revision except the project it was published in.
      if (
        !holdsMoveDestination({
          permissions: context.permissions,
          model: "feature",
          action: "revert",
          existing: feature,
          proposed: { ...feature, project: m.project },
          environments: revertFootprint({
            feature,
            targetRevision: revision,
            environmentIds,
            changedEnvs,
          }),
        })
      ) {
        context.permissions.throwPermissionError();
      }
      metadataChanges.project = m.project;
      hasMetaChange = true;
    }
    if (
      m.targetingAllProjects !== undefined &&
      m.targetingAllProjects !== (feature.targetingAllProjects ?? false)
    ) {
      metadataChanges.targetingAllProjects = m.targetingAllProjects;
      hasMetaChange = true;
    }
    if (
      m.targetingProjects !== undefined &&
      !isEqual(m.targetingProjects, feature.targetingProjects ?? [])
    ) {
      metadataChanges.targetingProjects = m.targetingProjects;
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
      // PAYLOAD-AFFECTING metadata only, matching the publish footprint, the
      // dashboard revert and the Revert control — all four now read one rule.
      // Inert metadata (description, owner, tags, neverStale, customFields) reaches
      // no SDK, so demanding revert authority over every serving environment for a
      // description-only restore refused changes with no live effect.
      if (
        metadataTouchesPayload(metadataChanges as Record<string, unknown>) &&
        !context.permissions.canRevertFeature(
          feature,
          Array.from(getEnabledEnvironments(feature, environmentIds)),
        )
      ) {
        context.permissions.throwPermissionError();
      }
      changes.metadata = metadataChanges;
    }
  }

  // Runs before the empty-diff check: a holdout-only difference is a real revert.
  const targetHoldout = getRevertTargetHoldout(revision);
  // Read-gated: restoring a holdout the caller cannot see would attach the
  // feature outside their scope, since publish resolves linkage unscoped.
  await assertValidHoldout(
    targetHoldout,
    context,
    changes.metadata?.project ?? feature.project,
  );
  if (!isEqual(targetHoldout, feature.holdout ?? null)) {
    // A revert of holdout membership is a revert like any other field here, so
    // revert authority lands it — while publish, being the broader authority
    // that could set the same value outright, still does too. Checking publish
    // alone made this the one field a revert-only role could not restore.
    if (
      !context.permissions.canRevertFeature(
        feature,
        Array.from(getEnabledEnvironments(feature, environmentIds)),
      ) &&
      !context.permissions.canPublishFeature(
        feature,
        Array.from(getEnabledEnvironments(feature, environmentIds)),
      )
    ) {
      context.permissions.throwPermissionError();
    }
    changes.holdout = targetHoldout;
  }

  // No diff against live — refuse before creating an empty "Locked" revision.
  if (Object.keys(changes).length === 0) {
    throw new Error(
      `Nothing to revert: the live feature already matches revision #${version}.`,
    );
  }

  // Flag restored values the current schema/value-type can no longer read as a
  // bypassable soft warning (?ignoreWarnings=true) instead of publishing blind.
  const valueWarnings = getRevertValueValidationWarnings(feature, changes);
  if (valueWarnings.length && !context.ignoreWarnings) {
    throw new SoftWarningError(
      "Reverting to this revision restores values that no longer pass validation:\n" +
        valueWarnings.join("\n"),
      valueWarnings,
    );
  }

  // Bypass via restApiBypassesReviews (API keys/PATs only — JWT-backed REST
  // calls should behave like dashboard actions), FlagsBypassApprovals, or the
  // org-wide "reverts bypass approval" setting (publish perms already enforced
  // per-change above, so any publisher may revert without approval).
  const permissionBypass = context.permissions.canBypassFlagApprovalChecks(
    feature,
    "feature",
  );
  const settingBypass = !!organization.settings?.revertsBypassApproval;
  const canBypass = canUseRestApiBypass || permissionBypass || settingBypass;

  // Asked whether or not the caller can bypass, so a successful revert can report
  // the approval it skipped. Guarded behind `!canBypass`, the answer was never
  // computed on the path where it matters most.
  const liveRevision = await getRevision({
    context,
    organization: feature.organization,
    featureId: feature.id,
    feature,
    version: feature.version,
  });
  if (!liveRevision) {
    throw new Error("Could not load live revision for Feature Flag");
  }
  const reviewRequired = checkIfRevisionNeedsReview({
    feature,
    baseRevision: liveRevision,
    revision: { ...liveRevision, ...changes } as typeof liveRevision,
    allEnvironments: allEnvironmentIds,
    settings: organization.settings,
    requireApprovalsLicensed: context.hasPremiumFeature("require-approvals"),
  });
  if (reviewRequired && !canBypass) {
    throw new PermissionError(
      "This revert requires approval before changes can be published. " +
        "Enable 'REST API always bypasses approval requirements' in organization settings, " +
        "or use a role/token that grants FlagsBypassApprovals on this project.",
    );
  }

  const bypassedGates: BypassedGate[] =
    reviewRequired && canBypass
      ? [
          {
            type: "approval-required",
            outcome: "bypassed",
            via: canUseRestApiBypass
              ? "restApiBypassesReviews"
              : permissionBypass
                ? "bypassApprovalPermission"
                : "revertsBypassApproval",
          },
        ]
      : [];

  const { revision: newRevision, updatedFeature } =
    await createAndPublishRevision({
      context,
      feature,
      user: eventAudit,
      org: organization,
      changes,
      comment: comment ?? `Reverted to revision #${version}`,
      canBypassApprovalChecks: canBypass,
      revertedFrom: version,
    });

  await audit({
    event: "feature.revert",
    entity: {
      object: "feature",
      id: feature.id,
    },
    details: auditDetailsUpdate(feature, updatedFeature, {
      revision: newRevision.version,
    }),
  });

  const groupMap = await getSavedGroupMap(context);
  const experimentMap = await getExperimentMapForFeature(context, feature.id);
  // Re-read so events and the response carry the published status; falls back
  // to the in-memory revision instead of failing the already-committed revert.
  const latestRevision = await getPublishedRevisionForEvents(
    context,
    updatedFeature,
    newRevision,
  );
  // Emit the same revision lifecycle events as the app's revert flow so
  // webhook consumers see API-initiated reverts too.
  await dispatchFeatureRevisionEvent(
    context,
    updatedFeature,
    latestRevision,
    "revision.reverted",
    { revertedToVersion: version },
  );
  await dispatchFeatureRevisionEvent(
    context,
    updatedFeature,
    latestRevision,
    "revision.published",
    {},
  );

  const safeRolloutMap =
    await context.models.safeRollout.getAllPayloadSafeRollouts();

  return {
    feature: updatedFeature,
    organization,
    groupMap,
    experimentMap,
    revision: latestRevision,
    safeRolloutMap,
    bypassedGates,
  };
}

export const revertFeature = createApiRequestHandler(revertFeatureValidator)(
  async (req) => {
    const data = await revertFeatureCore(
      req.context,
      req.organization,
      req.eventAudit,
      req.params,
      req.body,
      req.audit,
      canUseRestApiBypassSetting(req),
    );
    return {
      feature: await resolveOwnerEmail(getApiFeatureObj(data), req.context),
      ...(data.bypassedGates.length
        ? { bypassedGates: data.bypassedGates }
        : {}),
    };
  },
);
