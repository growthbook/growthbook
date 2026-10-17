import { useEffect, useState } from "react";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { usePreLaunchChecklist } from "@/components/PreLaunchChecklist/PreLaunchChecklistProvider";
import { isBypassableStartItem } from "@/components/PreLaunchChecklist/checklistSummary";
import {
  getStartActions,
  getStartSchedule,
  withServerChecklist,
} from "./startActions";
import { StartExperiment } from "./useStartExperiment";

export type StartUpgrade = "visual-editor" | "redirects";

function useStartUpgrade(
  experiment: Pick<
    ExperimentInterfaceStringDates,
    "hasVisualChangesets" | "hasURLRedirects"
  >,
): StartUpgrade | null {
  const { hasCommercialFeature } = useUser();
  return experiment.hasVisualChangesets &&
    !hasCommercialFeature("visual-editor")
    ? "visual-editor"
    : experiment.hasURLRedirects && !hasCommercialFeature("redirects")
      ? "redirects"
      : null;
}

/** What stands between the viewer and starting: checklist, bypass, button. */
export default function useStartGate({
  experiment,
  linkedFeatures,
  start,
}: {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  start: Pick<
    StartExperiment,
    "startExperiment" | "approveScheduledExperimentStart" | "checklistFailures"
  >;
}) {
  const permissionsUtil = usePermissionsUtil();
  const { summary, checklistItemsRemaining } = usePreLaunchChecklist();
  const [bypassed, setBypassed] = useState(false);
  // A refusal's items need their own acknowledgment, not an earlier tick.
  useEffect(() => {
    if (start.checklistFailures.length) setBypassed(false);
  }, [start.checklistFailures]);
  const upgrade = useStartUpgrade(experiment);

  const now = new Date();
  const scheduledStartAt = experiment.statusUpdateSchedule?.startAt
    ? new Date(experiment.statusUpdateSchedule.startAt)
    : null;
  const schedule = getStartSchedule(scheduledStartAt, now);

  // The server waives these on the experiment's project and publishes each
  // flag on its own.
  const approvalRows = summary.incomplete.blocking.filter(
    isBypassableStartItem,
  );
  const canBypassApproval =
    permissionsUtil.canBypassFlagApprovalChecks(experiment, "feature") &&
    approvalRows.every((row) => {
      const info = linkedFeatures.find((f) => f.feature.id === row.featureId);
      return (
        !!info &&
        permissionsUtil.canBypassFlagApprovalChecks(info.feature, "feature")
      );
    });
  const checklistLoading = checklistItemsRemaining === null;
  const checklist = withServerChecklist(
    {
      loading: checklistLoading,
      remaining: summary.remaining,
      blocking: summary.blocking,
      approval: approvalRows.length,
    },
    start.checklistFailures,
  );

  const actions = getStartActions({
    scheduledStartAt,
    now,
    checklist,
    canBypassApproval,
    needsUpgrade: !!upgrade,
    bypassed,
  });
  const runPrimary = () => {
    const skipChecklist = bypassed && checklist.remaining > 0;
    return actions.action === "approve-schedule"
      ? start.approveScheduledExperimentStart({ skipChecklist })
      : start.startExperiment({
          bypassApproval: bypassed && actions.waivesApproval,
          skipChecklist,
        });
  };

  return {
    checklistLoading,
    scheduledStartAt,
    schedule,
    upgrade,
    bypassed,
    setBypassed,
    actions,
    runPrimary,
  };
}
