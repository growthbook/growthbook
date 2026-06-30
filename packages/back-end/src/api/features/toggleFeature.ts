import type { AuditInterfaceInput } from "shared/types/audit";
import type { EventUser } from "shared/types/events/event-types";
import type { OrganizationInterface } from "shared/types/organization";
import { toggleFeatureValidator } from "shared/validators";
import {
  checkIfRevisionNeedsReview,
  getDraftAffectedEnvironments,
  PermissionError,
} from "shared/util";
import type { ApiReqContext } from "back-end/types/api";
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
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { getEnvironmentIdsFromOrg } from "back-end/src/services/organizations";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { canUseRestApiBypassSetting } from "./reviewBypass";

export async function toggleFeatureCore(
  context: ApiReqContext,
  organization: OrganizationInterface,
  eventAudit: EventUser,
  params: { id: string },
  body: {
    environments: Record<string, boolean | string | number>;
    reason?: string;
  },
  audit: (input: AuditInterfaceInput) => Promise<void>,
  canUseRestApiBypass: boolean,
) {
  const feature = await getFeature(context, params.id);
  if (!feature) {
    throw new Error("Could not find a feature with that key");
  }

  const environmentIds = getEnvironmentIdsFromOrg(organization);

  if (
    !context.permissions.canUpdateFeature(feature, {}) ||
    !context.permissions.canPublishFeature(
      feature,
      Object.keys(body.environments),
    )
  ) {
    context.permissions.throwPermissionError();
  }

  const toggles: Record<string, boolean> = {};
  Object.keys(body.environments).forEach((env) => {
    if (!environmentIds.includes(env)) {
      throw new Error(`Unknown environment: '${env}'`);
    }
    const state = [true, "true", "1", 1].includes(body.environments[env]);
    toggles[env] = state;
  });

  // Determine which envs actually changed
  const changedToggles: Record<string, boolean> = {};
  for (const [env, state] of Object.entries(toggles)) {
    if (feature.environmentSettings?.[env]?.enabled !== state) {
      changedToggles[env] = state;
    }
  }

  const groupMap = await getSavedGroupMap(context);
  const experimentMap = await getExperimentMapForFeature(context, feature.id);
  const safeRolloutMap =
    await context.models.safeRollout.getAllPayloadSafeRollouts();

  if (Object.keys(changedToggles).length === 0) {
    // No changes — return current state
    const revision = await getRevision({
      context,
      organization: feature.organization,
      featureId: feature.id,
      feature,
      version: feature.version,
    });
    return {
      feature,
      organization,
      groupMap,
      experimentMap,
      revision,
      safeRolloutMap,
    };
  }

  // Callers bypass the review gate via either the org-level
  // restApiBypassesReviews setting (API keys/PATs only — JWT-backed REST
  // calls should behave like dashboard actions) or a role/token that grants
  // the bypassApprovalChecks permission on this feature's project.
  const canBypass =
    canUseRestApiBypass || context.permissions.canBypassApprovalChecks(feature);
  // Build a minimal fake revision to check whether these toggle changes need review
  const liveRevision = await getRevision({
    context,
    organization: feature.organization,
    featureId: feature.id,
    feature,
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
    settings: organization.settings,
    requireApprovalsLicensed: context.hasPremiumFeature("require-approvals"),
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
    context,
    feature,
    user: eventAudit,
    baseVersion: feature.version,
    comment: "Created via REST API",
    environments: environmentIds,
    publish: true,
    changes: { environmentsEnabled: changedToggles },
    org: organization,
    canBypassApprovalChecks: true, // review gate enforced above
  });

  const updatedFeature = await applyRevisionChanges(
    context,
    feature,
    revision,
    { environmentsEnabled: changedToggles },
  );

  await audit({
    event: "feature.toggle",
    entity: { object: "feature", id: feature.id },
    details: auditDetailsUpdate(feature, updatedFeature),
    reason: body.reason,
  });

  const updatedExperimentMap = await getExperimentMapForFeature(
    context,
    updatedFeature.id,
  );
  const latestRevision = await getRevision({
    context,
    organization: updatedFeature.organization,
    featureId: updatedFeature.id,
    feature: updatedFeature,
    version: updatedFeature.version,
  });
  return {
    feature: updatedFeature,
    organization,
    groupMap,
    experimentMap: updatedExperimentMap,
    revision: latestRevision,
    safeRolloutMap,
  };
}

export const toggleFeature = createApiRequestHandler(toggleFeatureValidator)(
  async (req) => {
    const data = await toggleFeatureCore(
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
    };
  },
);
