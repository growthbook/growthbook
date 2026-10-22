import { rollbackFeatureV2Validator } from "shared/validators";
import type { FeatureRule } from "shared/validators";
import type { FeatureInterface } from "shared/types/feature";
import type { AuditInterfaceInput } from "shared/types/audit";
import type { EventUser } from "shared/types/events/event-types";
import {
  checkIfRevisionNeedsReview,
  getApplicableEnvIds,
  PermissionError,
} from "shared/util";
import type { ApiReqContext } from "back-end/types/api";
import type { BypassedGate } from "back-end/src/revisions/publishGates";
import {
  LandingConflictError,
  runGuardedWrite,
} from "back-end/src/revisions/landingSequence";
import {
  applyRevisionChanges,
  getFeature,
} from "back-end/src/models/FeatureModel";
import {
  createRevision,
  deleteRevisionForFailedLanding,
  getRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { getExperimentMapForFeature } from "back-end/src/models/ExperimentModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { holdFeatureUpdate } from "back-end/src/services/confirmations";
import {
  getApiFeatureObjV2,
  getFeatureDefinitionLookups,
} from "back-end/src/services/features";
import {
  dispatchFeatureRevisionEvent,
  getPublishedRevisionForEvents,
} from "back-end/src/services/featureRevisionEvents";
import { getEnvironmentIdsFromOrg } from "back-end/src/services/organizations";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import {
  rollbackSchedule,
  runControlledRampScheduleAction,
} from "back-end/src/services/rampSchedule";
import { loadRolloutLookups } from "back-end/src/services/rollouts";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { logger } from "back-end/src/util/logger";
import { getEnvironments } from "back-end/src/util/organization.util";
import {
  type ActiveRollout,
  getActiveRollouts,
} from "back-end/src/util/rollouts";
import { canUseRestApiBypassSetting } from "./reviewBypass";

export const rollbackFeatureV2 = createApiRequestHandler(
  rollbackFeatureV2Validator,
)(async (req) => {
  const { context, organization } = req;
  let feature = await getFeature(context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  const orgEnvIds = getEnvironmentIdsFromOrg(organization);
  const applicableEnvs = getApplicableEnvIds(
    getEnvironments(organization),
    feature,
  );
  const environments = req.body.environments ?? applicableEnvs;
  for (const env of environments) {
    if (!orgEnvIds.includes(env)) {
      throw new BadRequestError(`Unknown environment: '${env}'`);
    }
  }
  const comment = req.body.comment ?? "Rolled back via REST API";

  const activeRollouts = async (f: FeatureInterface) => {
    const lookups = await loadRolloutLookups(context, [f]);
    return environments.flatMap((env) => getActiveRollouts(f, env, lookups));
  };

  const rollouts = await activeRollouts(feature);
  const affectedEnvs = [...new Set(rollouts.map((r) => r.environment))];
  if (!context.permissions.canPublishFeature(feature, affectedEnvs)) {
    context.permissions.throwPermissionError();
  }
  if (!rollouts.length) {
    return { feature: await apiFeature(context, feature), rolledBack: [] };
  }

  // Ramp schedules land their own revisions, so they go first; the rule
  // changes below are then computed from the feature as they left it.
  const rolledBack: ActiveRollout[] = [];
  const rampIds = new Set(
    rollouts.flatMap((r) => (r.rampScheduleId ? [r.rampScheduleId] : [])),
  );
  for (const id of rampIds) {
    await runControlledRampScheduleAction(context, id, async (fresh) => {
      if (["completed", "rolled-back"].includes(fresh.status)) return fresh;
      return rollbackSchedule(context, fresh, `REST API rollback: ${comment}`);
    });
    rolledBack.push(...rollouts.filter((r) => r.rampScheduleId === id));
  }
  if (rampIds.size) {
    feature = await getFeature(context, req.params.id);
    if (!feature) throw new NotFoundError("Could not find feature");
  }

  // A ramp's rule is left as its schedule's rollback put it, the same as the
  // ramp-schedule rollback endpoint; only rules the ramp did not own change here.
  const rampRuleIds = new Set(rolledBack.map((r) => r.ruleId));
  const ruleRollouts = (
    rampIds.size ? await activeRollouts(feature) : rollouts
  ).filter((r) => r.type !== "ramp-schedule" && !rampRuleIds.has(r.ruleId));
  let bypassedGates: BypassedGate[] = [];
  if (ruleRollouts.length) {
    const ruleIds = new Set(ruleRollouts.map((r) => r.ruleId));
    const rules: FeatureRule[] = (feature.rules ?? []).map((rule) => {
      if (!ruleIds.has(rule.id)) return rule;
      return rule.type === "safe-rollout"
        ? { ...rule, status: "rolled-back" }
        : { ...rule, enabled: false };
    });
    const ruleEnvs = [...new Set(ruleRollouts.map((r) => r.environment))];
    bypassedGates = await publishRules({
      context,
      feature,
      rules,
      environments: ruleEnvs,
      comment,
      reason: req.body.reason,
      user: req.eventAudit,
      audit: req.audit,
      canUseRestApiBypass: canUseRestApiBypassSetting(req),
    });

    for (const r of ruleRollouts) {
      if (!r.safeRolloutId) continue;
      const safeRollout = await context.models.safeRollout.getById(
        r.safeRolloutId,
      );
      if (safeRollout && safeRollout.status === "running") {
        await context.models.safeRollout.update(safeRollout, {
          status: "rolled-back",
        });
      }
    }
    rolledBack.push(...ruleRollouts);
    feature = (await getFeature(context, req.params.id)) ?? feature;
  }

  return {
    feature: await apiFeature(context, feature),
    rolledBack,
    ...(bypassedGates.length ? { bypassedGates } : {}),
  };
});

// Same landing as a toggle: review gate, confirmation hold, one published
// revision, guarded write, audit and the revision.published event.
async function publishRules({
  context,
  feature,
  rules,
  environments,
  comment,
  reason,
  user,
  audit,
  canUseRestApiBypass,
}: {
  context: ApiReqContext;
  feature: FeatureInterface;
  rules: FeatureRule[];
  environments: string[];
  comment: string;
  reason?: string;
  user: EventUser;
  audit: (input: AuditInterfaceInput) => Promise<void>;
  canUseRestApiBypass: boolean;
}): Promise<BypassedGate[]> {
  const organization = context.org;
  const liveRevision = await getRevision({
    context,
    organization: feature.organization,
    featureId: feature.id,
    feature,
    version: feature.version,
  });
  if (!liveRevision)
    throw new Error("Could not load live revision for feature");

  const canBypass =
    canUseRestApiBypass ||
    context.permissions.canBypassFlagApprovalChecks(feature, "feature");
  const reviewRequired = checkIfRevisionNeedsReview({
    feature,
    baseRevision: liveRevision,
    revision: { ...liveRevision, rules },
    orgEnvironments: getEnvironments(organization),
    settings: organization.settings,
    requireApprovalsLicensed: context.hasPremiumFeature("require-approvals"),
  });
  if (reviewRequired && !canBypass) {
    throw new PermissionError(
      `This feature requires a review before publishing changes to: ${environments.join(", ")}. ` +
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
              : "bypassApprovalPermission",
          },
        ]
      : [];

  await holdFeatureUpdate(
    context,
    feature,
    { rules: true },
    bypassedGates,
    environments,
  );

  const revision = await createRevision({
    context,
    feature,
    user,
    baseVersion: feature.version,
    comment,
    environments: getEnvironmentIdsFromOrg(organization),
    publish: true,
    changes: { rules },
    org: organization,
    canBypassApprovalChecks: true, // review gate enforced above
  });

  let updated: FeatureInterface;
  try {
    updated = await runGuardedWrite("feature", feature.id, () =>
      applyRevisionChanges(context, feature, revision, { rules }),
    );
  } catch (e) {
    if (e instanceof LandingConflictError) {
      await deleteRevisionForFailedLanding(
        context,
        context.org.id,
        feature.id,
        revision.version,
      ).catch((cleanupErr: unknown) => {
        logger.error(
          cleanupErr,
          `Feature rollback for ${feature.id} lost its landing race AND failed to remove revision v${revision.version}; that revision is phantom history and needs removing by hand`,
        );
      });
    }
    throw e;
  }

  await audit({
    event: "feature.publish",
    entity: { object: "feature", id: feature.id },
    details: auditDetailsUpdate(feature, updated),
    reason,
  });
  try {
    await dispatchFeatureRevisionEvent(
      context,
      updated,
      await getPublishedRevisionForEvents(context, updated, revision),
      "revision.published",
      {},
    );
  } catch (e) {
    logger.error(
      e,
      `Failed to dispatch revision.published for feature ${updated.id}`,
    );
  }
  return bypassedGates;
}

async function apiFeature(context: ApiReqContext, feature: FeatureInterface) {
  const experimentMap = await getExperimentMapForFeature(context, feature.id);
  const revision = await getRevision({
    context,
    organization: feature.organization,
    featureId: feature.id,
    feature,
    version: feature.version,
  });
  const lookups = await getFeatureDefinitionLookups(context, {
    features: [feature],
    experiments: experimentMap.values(),
  });
  return resolveOwnerEmail(
    getApiFeatureObjV2({
      feature,
      organization: context.org,
      experimentMap,
      revision,
      ...lookups,
    }),
    context,
  );
}
