import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { canBypassStartApproval } from "shared/permissions";
import type { AutoExperimentFeature } from "shared/types/organization";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useAutoExperiments from "@/hooks/useAutoExperiments";
import { usePreLaunchChecklist } from "@/components/PreLaunchChecklist/PreLaunchChecklistProvider";
import { isBypassableStartItem } from "@/components/PreLaunchChecklist/checklistSummary";
import {
  getStartActions,
  getStartSchedule,
  withServerChecklist,
} from "./startActions";
import { StartExperiment } from "./useStartExperiment";

export type StartUpgrade = "visual-editor" | "redirects";
export type StartNotEnabled = Extract<
  AutoExperimentFeature,
  "visualEditor" | "urlRedirects"
>;

/** What stands between the viewer and starting: checklist, bypass, button. */
export default function useStartGate({
  experiment,
  linkedFeatures,
  start,
  bypassed,
}: {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  start: Pick<
    StartExperiment,
    "startExperiment" | "approveScheduledExperimentStart" | "checklistFailures"
  >;
  bypassed: boolean;
}) {
  const permissionsUtil = usePermissionsUtil();
  const { hasCommercialFeature } = useUser();
  const { summary, checklistItemsRemaining } = usePreLaunchChecklist();
  const upgrade: StartUpgrade | null =
    experiment.hasVisualChangesets && !hasCommercialFeature("visual-editor")
      ? "visual-editor"
      : experiment.hasURLRedirects && !hasCommercialFeature("redirects")
        ? "redirects"
        : null;
  const { isEnabled } = useAutoExperiments();
  // Not a hard block: an admin enables it from the popover.
  const notEnabled: StartNotEnabled | null =
    experiment.hasVisualChangesets && !isEnabled("visualEditor")
      ? "visualEditor"
      : experiment.hasURLRedirects && !isEnabled("urlRedirects")
        ? "urlRedirects"
        : null;

  const now = new Date();
  const scheduledStartAt = experiment.statusUpdateSchedule?.startAt
    ? new Date(experiment.statusUpdateSchedule.startAt)
    : null;
  const schedule = getStartSchedule(scheduledStartAt, now);

  const approvalRows = summary.incomplete.blocking.filter(
    isBypassableStartItem,
  );
  const canBypassApproval = approvalRows.every((row) => {
    const info = linkedFeatures.find((f) => f.feature.id === row.featureId);
    return (
      !!info &&
      canBypassStartApproval(permissionsUtil, experiment, info.feature)
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
  // What still stands in the way once this viewer's bypass is counted.
  const blockers = summary.incomplete.blocking.filter(
    (item) => !(actions.waivesApproval && isBypassableStartItem(item)),
  );
  const runPrimary = () => {
    const skipChecklist = bypassed && checklist.remaining > 0;
    const bypassApproval = bypassed && actions.waivesApproval;
    return actions.action === "approve-schedule"
      ? start.approveScheduledExperimentStart({ skipChecklist, bypassApproval })
      : start.startExperiment({ bypassApproval, skipChecklist });
  };

  return {
    checklistLoading,
    scheduledStartAt,
    schedule,
    upgrade,
    notEnabled,
    actions,
    blockers,
    runPrimary,
  };
}
