import {
  getSafeRolloutDaysLeft,
  getHealthSettings,
  getSafeRolloutResultStatus,
} from "shared/enterprise";
import { autoMerge } from "shared/util";
import {
  SafeRolloutInterface,
  SafeRolloutSnapshotInterface,
} from "back-end/types/safe-rollout";
import { SafeRolloutStatus } from "back-end/src/validators/safe-rollout";
import { ReqContext } from "back-end/types/organization";
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

export interface UpdateRampUpScheduleParams {
  context: ReqContext | ApiReqContext;
  safeRollout: SafeRolloutInterface;
  status: SafeRolloutStatus;
}
export async function updateRampUpSchedule({
  context,
  safeRollout,
  status,
}: UpdateRampUpScheduleParams): Promise<void> {
  if (
    status === "running" &&
    safeRollout.rampUpSchedule.enabled &&
    !safeRollout.rampUpSchedule.rampUpCompleted &&
    safeRollout.rampUpSchedule?.nextUpdate &&
    safeRollout.rampUpSchedule.nextUpdate < new Date()
  ) {
    const rampUpSchedule = safeRollout.rampUpSchedule;
    const rampUpCompleted =
      rampUpSchedule.step === rampUpSchedule.steps.length - 1;

    const step = rampUpCompleted
      ? rampUpSchedule.step // keep the step the same if it is completed
      : rampUpSchedule.step + 1;

    await context.models.safeRollout.update(safeRollout, {
      rampUpSchedule: {
        ...rampUpSchedule,
        step,
        rampUpCompleted,
        lastUpdate: new Date(),
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
  const daysLeft = getSafeRolloutDaysLeft({
    safeRollout: updatedSafeRollout,
    snapshotWithResults: safeRolloutSnapshot,
  });
  const healthSettings = getHealthSettings(
    context.org.settings,
    orgHasPremiumFeature(context.org, "decision-framework")
  );
  const safeRolloutStatus = getSafeRolloutResultStatus({
    safeRollout: updatedSafeRollout,
    healthSettings,
    daysLeft,
  });
  let status: SafeRolloutStatus = updatedSafeRollout.status;
  if (
    safeRolloutStatus?.status &&
    ["unhealthy", "rollback-now"].includes(safeRolloutStatus.status)
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
      revision,
      updatedSafeRollout.environment,
      ruleIndex,
      { status },
      context.auditUser,
      false
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
      {}
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
      "auto-publish status change"
    );
  }
  return status;
}
