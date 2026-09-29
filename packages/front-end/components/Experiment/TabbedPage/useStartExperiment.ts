import { useCallback, useState } from "react";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import {
  ApiErrorDetails,
  HoldoutInterfaceStringDates,
} from "shared/validators";
import {
  experimentHasLiveLinkedChanges,
  getImplementationType,
  hasStartReadyManagedFlag,
} from "shared/util";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useCelebration } from "@/hooks/useCelebration";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import track from "@/services/track";
import { ServerChecklistItem } from "./startActions";

export type PendingDraftFailure =
  ApiErrorDetails<"pending_draft_publish_failed">["failedFeatureDrafts"][number];

type StartRefusal = {
  code?: string;
  details?: {
    failedFeatureDrafts?: PendingDraftFailure[];
    remainingChecklistItems?: ServerChecklistItem[];
  };
};

export type StartExperiment = ReturnType<typeof useStartExperiment>;

/** Starting an experiment or holdout, shared by the header and the review. */
export default function useStartExperiment({
  experiment,
  holdout,
  envs,
  linkedFeatures,
  mutate,
  newPhase,
  onStarted,
}: {
  experiment: ExperimentInterfaceStringDates;
  holdout?: HoldoutInterfaceStringDates;
  envs: string[];
  linkedFeatures: LinkedFeatureInfo[];
  mutate: () => void;
  newPhase?: (() => void) | null;
  onStarted: () => void;
}) {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const { getDatasourceById } = useDefinitions();
  const startCelebration = useCelebration();
  const isHoldout = experiment.type === "holdout";
  const isBandit = experiment.type === "multi-armed-bandit";

  // Per-flag failures from the last failed start, so each blocked draft can be
  // linked instead of only showing the error string.
  const [pendingDraftFailures, setPendingDraftFailures] = useState<
    PendingDraftFailure[]
  >([]);
  // The To Do items the server refused the last attempt on.
  const [checklistFailures, setChecklistFailures] = useState<
    ServerChecklistItem[]
  >([]);
  const clearStartFailures = useCallback(() => {
    setPendingDraftFailures([]);
    setChecklistFailures([]);
  }, []);

  function keepStartFailures(responseData: StartRefusal | null) {
    const details = responseData?.details;
    if (
      responseData?.code === "pending_draft_publish_failed" &&
      Array.isArray(details?.failedFeatureDrafts)
    ) {
      setPendingDraftFailures(details.failedFeatureDrafts);
    } else if (
      responseData?.code === "checklist_incomplete" &&
      Array.isArray(details?.remainingChecklistItems)
    ) {
      setChecklistFailures(details.remainingChecklistItems);
      // The page may be behind what the server just checked.
      mutate();
    }
  }

  const hasUpdatePermissions = !holdout
    ? permissionsUtil.canUpdateExperiment(experiment, {})
    : permissionsUtil.canUpdateHoldout(holdout, { projects: holdout.projects });
  const canRunExperiment =
    !experiment.archived &&
    hasUpdatePermissions &&
    (envs.length === 0 || permissionsUtil.canRunExperiment(experiment, envs));

  const banditImplementationReady =
    !isBandit ||
    experimentHasLiveLinkedChanges(experiment, linkedFeatures) ||
    hasStartReadyManagedFlag(experiment.id, linkedFeatures);
  const banditBlockedReason = banditImplementationReady
    ? null
    : getImplementationType(experiment) === "values"
      ? "Add variation values before starting."
      : "Add at least one live Linked Feature, Visual Editor change, or URL Redirect before starting.";

  async function startExperiment(opts?: {
    bypassApproval?: boolean;
    skipChecklist?: boolean;
  }) {
    // Only a holdout starts by adding its first phase; an experiment waits on
    // its targeting row, a hard block while it has none.
    if (!experiment.phases?.length) {
      if (!isHoldout) {
        throw new Error("Set up targeting before starting this experiment.");
      }
      if (!newPhase) {
        throw new Error("You do not have permission to start this experiment");
      }
      newPhase();
      return;
    }

    clearStartFailures();
    if (isHoldout) {
      await apiCall(`/holdout/${holdout?.id}/edit-status`, {
        method: "POST",
        body: JSON.stringify({
          status: "running",
          holdoutRunningStatus: "running",
        }),
      });
    } else {
      await apiCall(
        `/experiment/${experiment.id}/status`,
        {
          method: "POST",
          body: JSON.stringify({
            status: "running",
            bypassLockdown: !!opts?.bypassApproval,
            skipChecklist: !!opts?.skipChecklist,
          }),
        },
        keepStartFailures,
      );
    }
    await mutate();
    startCelebration();

    track("Start experiment", {
      source: "experiment-start-banner",
      action: "main CTA",
      hasDatasource: !!getDatasourceById(experiment.datasource),
      hasExperimentAssignmentQuery: !!experiment.exposureQueryId,
    });
    onStarted();
  }

  async function approveScheduledExperimentStart(opts?: {
    skipChecklist?: boolean;
  }) {
    clearStartFailures();
    await apiCall(
      `/experiment/${experiment.id}/approve-scheduled-start`,
      {
        method: "POST",
        body: JSON.stringify({ skipChecklist: !!opts?.skipChecklist }),
      },
      keepStartFailures,
    );
    await mutate();

    track("Approve Scheduled Experiment Start", {
      source: "experiment-start-banner",
      action: "main CTA",
    });
  }

  return {
    canRunExperiment,
    banditBlockedReason,
    pendingDraftFailures,
    checklistFailures,
    clearStartFailures,
    startExperiment,
    approveScheduledExperimentStart,
  };
}
