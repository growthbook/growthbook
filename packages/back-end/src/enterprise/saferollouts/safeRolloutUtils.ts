import {
  getSafeRolloutDaysLeft,
  getHealthSettings,
  getSafeRolloutResultStatus,
} from "shared/enterprise";
import { autoMerge } from "shared/util";
import { SafeRolloutStatus } from "shared/src/validators/safe-rollout";
import {
  SafeRolloutInterface,
  SafeRolloutSnapshotInterface,
} from "back-end/types/safe-rollout";
import { OrganizationInterface } from "back-end/types/organization";
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
import { FeatureInterface } from "back-end/types/feature";
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
  ruleIndex,
  feature,
}: {
  context: ReqContext;
  updatedSafeRollout: SafeRolloutInterface;
  safeRolloutSnapshot: SafeRolloutSnapshotInterface;
  ruleIndex: number;
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
      environments: [updatedSafeRollout.environment],
      baseVersion: feature.version,
      org: context.org,
    });
    await editFeatureRule(
      context,
      feature,
      revision,
      updatedSafeRollout.environment,
      ruleIndex,
      { status },
      context.auditUser,
      false,
    );
    const live = await getRevision({
      context,
      organization: updatedSafeRollout.organization,
      featureId: feature.id,
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
            version: revision.baseVersion,
          });
    if (!base) {
      throw new Error("Could not lookup feature history");
    }

    const mergeResult = autoMerge(
      live,
      base,
      revision,
      [updatedSafeRollout.environment],
      {},
    );
    if (!mergeResult.success) {
      throw new Error("could not merge the status");
    }
    //publish the revision
    await publishRevision(
      context,
      feature,
      revision,
      mergeResult.result,
      "auto-publish status change",
    );
  }
  return status;
}

export function determineNextSafeRolloutSnapshotAttempt(
  safeRollout: SafeRolloutInterface,
  organization: OrganizationInterface,
): { nextSnapshot: Date; nextRampUp: Date } {
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
