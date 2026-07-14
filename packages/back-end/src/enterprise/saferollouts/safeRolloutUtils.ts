import {
  getSafeRolloutDaysLeft,
  getHealthSettings,
  getSafeRolloutResultStatus,
} from "shared/enterprise";
import { autoMerge } from "shared/util";
import { SafeRolloutStatus, SafeRolloutRule } from "shared/validators";
import {
  SafeRolloutInterface,
  SafeRolloutSnapshotInterface,
} from "shared/types/safe-rollout";
import { OrganizationInterface } from "shared/types/organization";
import { FeatureInterface } from "shared/types/feature";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { orgHasPremiumFeature } from "back-end/src/enterprise/licenseUtil";
import {
  editFeatureRule,
  publishRevision,
} from "back-end/src/models/FeatureModel";
import {
  createRevision,
  getRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { getSafeRolloutRuleFromFeature } from "back-end/src/routers/safe-rollout/safe-rollout.helper";
import { determineNextDate } from "back-end/src/services/experiments";

export interface UpdateRampUpScheduleParams {
  context: ReqContext | ApiReqContext;
  safeRollout: SafeRolloutInterface;
}
export async function updateRampUpSchedule({
  context,
  safeRollout,
}: UpdateRampUpScheduleParams): Promise<void> {
  const { status, rampUpSchedule } = safeRollout;
  if (
    status === "running" &&
    rampUpSchedule.enabled &&
    !rampUpSchedule.rampUpCompleted &&
    rampUpSchedule?.nextUpdate &&
    rampUpSchedule.nextUpdate < new Date()
  ) {
    const rampUpCompleted =
      rampUpSchedule.step === rampUpSchedule.steps.length - 1;

    const step = rampUpCompleted
      ? rampUpSchedule.step // keep the step the same if it is completed
      : rampUpSchedule.step + 1;
    const { nextRampUp } = determineNextSafeRolloutSnapshotAttempt(
      safeRollout,
      context.org,
    );
    await context.models.safeRollout.update(safeRollout, {
      rampUpSchedule: {
        ...rampUpSchedule,
        step,
        steps: rampUpSchedule.steps.map((stepObj, index) =>
          index === step ? { ...stepObj, dateRampedUp: new Date() } : stepObj,
        ),
        rampUpCompleted,
        lastUpdate: new Date(),
        nextUpdate: nextRampUp,
      },
    });
  }
}

export async function checkAndRollbackSafeRollout({
  context,
  updatedSafeRollout,
  safeRolloutSnapshot,
  ruleId,
  feature,
}: {
  context: ReqContext;
  updatedSafeRollout: SafeRolloutInterface;
  safeRolloutSnapshot: SafeRolloutSnapshotInterface;
  ruleId: string;
  feature: FeatureInterface;
}): Promise<SafeRolloutStatus> {
  if (updatedSafeRollout.status !== "running") return updatedSafeRollout.status;
  if (!updatedSafeRollout.autoRollback) return updatedSafeRollout.status;

  const daysLeft = getSafeRolloutDaysLeft({
    safeRollout: updatedSafeRollout,
    snapshotWithResults: safeRolloutSnapshot,
  });
  const healthSettings = getHealthSettings(
    context.org.settings,
    orgHasPremiumFeature(context.org, "decision-framework"),
  );
  const safeRolloutStatus = getSafeRolloutResultStatus({
    safeRollout: updatedSafeRollout,
    healthSettings,
    daysLeft,
  });
  // getSafeRolloutRuleFromFeature projects feature.rules through
  // getRulesForEnvironment, which uses ruleAppliesToEnv. A rule with
  // allEnvironments: false and environments: [] passes no environment check
  // and returns null — causing ruleEnvs: [] and a silent no-op rollback.
  // Fall back to a direct flat-rules lookup by ruleId so the rollback always
  // fires when the rule genuinely exists on the feature.
  const rule: SafeRolloutRule | null =
    getSafeRolloutRuleFromFeature(feature, updatedSafeRollout.id) ??
    (feature.rules ?? []).find(
      (r): r is SafeRolloutRule => r.type === "safe-rollout" && r.id === ruleId,
    ) ??
    null;
  // When environments is empty but the rule exists, fall back to the
  // SafeRollout's own environment field so the revision covers at least
  // the one environment the rollout is actually running in.
  const ruleEnvs: string[] = rule?.allEnvironments
    ? Object.keys(feature.environmentSettings)
    : rule?.environments?.length
      ? rule.environments
      : [updatedSafeRollout.environment].filter((e): e is string => !!e);

  let status: SafeRolloutStatus = updatedSafeRollout.status;
  if (
    safeRolloutStatus?.status &&
    "rollback-now" === safeRolloutStatus.status
  ) {
    status = "rolled-back";
    const revision = await createRevision({
      context,
      feature,
      user: context.auditUser,
      environments: ruleEnvs,
      baseVersion: feature.version,
      org: context.org,
    });
    await editFeatureRule(
      context,
      feature,
      revision,
      ruleId,
      { status },
      context.auditUser,
      false,
      ruleEnvs[0],
    );
    const live = await getRevision({
      context,
      organization: updatedSafeRollout.organization,
      featureId: feature.id,
      feature,
      version: feature.version,
    });
    if (!live) {
      throw new Error("Could not lookup feature history");
    }

    const base =
      revision.baseVersion === live.version
        ? live
        : await getRevision({
            context,
            organization: updatedSafeRollout.organization,
            featureId: feature.id,
            feature,
            version: revision.baseVersion,
          });
    if (!base) {
      throw new Error("Could not lookup feature history");
    }

    const mergeResult = autoMerge(live, base, revision, ruleEnvs, {});
    if (!mergeResult.success) {
      throw new Error("could not merge the status");
    }
    await publishRevision({
      context,
      feature,
      revision,
      result: mergeResult.result,
      comment: "auto-publish status change",
      bypassLockdown: true,
    });
  }
  return status;
}

export function determineNextSafeRolloutSnapshotAttempt(
  safeRollout: SafeRolloutInterface,
  organization: OrganizationInterface,
): { nextSnapshot: Date; nextRampUp: Date } {
  // Monitored ramp schedules carry their own refresh cadence in minutes. Honor
  // it directly. The org-wide experiment update schedule below is far coarser
  // (often daily) and would starve short monitored steps of the fresh analysis
  // they need to advance, stranding them until the next org refresh.
  if (safeRollout.updateScheduleMinutes) {
    const next = new Date(
      Date.now() + safeRollout.updateScheduleMinutes * 60 * 1000,
    );
    return { nextSnapshot: next, nextRampUp: next };
  }

  const rampUpSchedule = safeRollout?.rampUpSchedule;
  const nextUpdate =
    determineNextDate(organization.settings?.updateSchedule || null) ||
    new Date(Date.now() + 1 * 24 * 60 * 60 * 1000); // 1 day ;
  if (
    !rampUpSchedule ||
    rampUpSchedule?.rampUpCompleted ||
    !rampUpSchedule?.enabled
  ) {
    return {
      nextSnapshot: nextUpdate,
      nextRampUp: rampUpSchedule?.nextUpdate || nextUpdate,
    };
  }

  let maxDurationInSeconds: number; // in seconds
  switch (safeRollout.maxDuration.unit) {
    case "days":
      maxDurationInSeconds = safeRollout.maxDuration.amount * 86400;
      break;
    case "weeks":
      maxDurationInSeconds = safeRollout.maxDuration.amount * 604800;
      break;
    case "hours":
      maxDurationInSeconds = safeRollout.maxDuration.amount * 3600;
      break;
    case "minutes":
      maxDurationInSeconds = safeRollout.maxDuration.amount * 60;
      break;
    default:
      throw new Error("Invalid max duration unit");
  }
  const fullRampUpTimeInSeconds = maxDurationInSeconds * 0.25; // hard coded to 25% of the max duration that is the ramp up time
  const rampUpTimeBetweenStepsInSeconds =
    fullRampUpTimeInSeconds / rampUpSchedule.steps.length;
  return {
    nextSnapshot: new Date(
      Math.min(
        (rampUpSchedule.lastUpdate?.getTime() ?? Date.now()) +
          rampUpTimeBetweenStepsInSeconds * 1000,
        rampUpSchedule.nextUpdate?.getTime() ?? Infinity,
      ),
    ),
    nextRampUp: new Date(
      (rampUpSchedule.lastUpdate?.getTime() ?? Date.now()) +
        rampUpTimeBetweenStepsInSeconds * 1000,
    ),
  };
}
