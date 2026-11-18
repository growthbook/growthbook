import React from "react";
import { Queries } from "shared/types/query";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { ExperimentSnapshotAnalysisSettings } from "shared/types/experiment-snapshot";
import {
  SafeRolloutInterface,
  SafeRolloutSnapshotInterface,
} from "shared/validators";
import { useAuth } from "@/services/auth";
import RunQueriesButton, {
  getQueryStatus,
} from "@/components/Queries/RunQueriesButton";
import ExperimentRefreshSnapshotButton from "@/components/Experiment/RefreshSnapshotButton";
import SafeRolloutRefreshSnapshotButton from "@/components/SafeRollout/RefreshSnapshotButton";
import {
  type SnapshotRefreshBlocker,
  useExperimentSnapshotUpdate,
} from "@/hooks/useExperimentSnapshotUpdate";
import FullRefreshRequiredDialog from "@/components/Experiment/FullRefreshRequiredDialog";
import NewMetricsUpdateButton from "@/components/Experiment/NewMetricsUpdateButton";

export type EntityType = "experiment" | "holdout" | "safe-rollout";

type RefreshResultsModel = {
  id: string;
  queries?: Queries;
  runStarted?: string | Date | null;
};

export interface RefreshResultsButtonProps<T extends RefreshResultsModel> {
  entityType: EntityType;
  entityId: string;
  datasourceId?: string | null;
  latest?: T;
  mutate: () => void;
  mutateAdditional?: () => void;
  setRefreshError: (error: string) => void;
  setRefreshNotice?: (notice: string) => void;
  experimentSnapshotTrackingProps?: {
    trackingSource: string;
    datasourceType: string | null;
  };
  onSuccess?: () => void;
  // Return false to abort the refresh (e.g. to open a confirmation dialog
  // instead). Mirrors Modal's customValidation. Side effects are allowed.
  customValidation?: () => boolean | Promise<boolean>;
  onSnapshotRefreshBlocked?: (blocker: SnapshotRefreshBlocker) => void;
  // Experiment/holdout-specific props
  experiment?: ExperimentInterfaceStringDates;
  phase?: number;
  dimension?: string;
  setAnalysisSettings?: (
    settings: ExperimentSnapshotAnalysisSettings | null,
  ) => void;
  safeRollout?: SafeRolloutInterface;
  fullRefreshRequired?: boolean;
  fullRefreshReasons?: string[];
  // Offer "Update new metrics" as the main action, with "Update all metrics"
  // in the menu.
  newMetricsUpdate?: boolean;
  disabled?: boolean;
}

export default function RefreshResultsButton<T extends RefreshResultsModel>({
  entityType,
  entityId,
  datasourceId,
  latest,
  mutate,
  mutateAdditional,
  setRefreshError,
  setRefreshNotice,
  experimentSnapshotTrackingProps,
  onSuccess,
  customValidation,
  onSnapshotRefreshBlocked,
  experiment,
  phase,
  dimension,
  safeRollout,
  fullRefreshRequired = false,
  fullRefreshReasons = [],
  newMetricsUpdate = false,
  disabled = false,
}: RefreshResultsButtonProps<T>) {
  const hasQueries = (latest?.queries?.length ?? 0) > 0;
  if (datasourceId && latest && hasQueries) {
    return (
      <RefreshRunQueriesButton
        entityType={entityType}
        entityId={entityId}
        latest={latest}
        mutate={mutate}
        mutateAdditional={mutateAdditional}
        setRefreshError={setRefreshError}
        setRefreshNotice={setRefreshNotice}
        experimentSnapshotTrackingProps={experimentSnapshotTrackingProps}
        onSuccess={onSuccess}
        customValidation={customValidation}
        onSnapshotRefreshBlocked={onSnapshotRefreshBlocked}
        experiment={experiment}
        phase={phase}
        dimension={dimension}
        fullRefreshRequired={fullRefreshRequired}
        fullRefreshReasons={fullRefreshReasons}
        newMetricsUpdate={newMetricsUpdate}
        disabled={disabled}
      />
    );
  }

  if (
    (entityType === "experiment" || entityType === "holdout") &&
    experiment &&
    phase !== undefined
  ) {
    return (
      <ExperimentRefreshSnapshotButton
        mutate={() => {
          mutate();
          mutateAdditional?.();
        }}
        phase={phase}
        experiment={experiment}
        dimension={dimension}
        setError={(error) => setRefreshError(error ?? "")}
        setRefreshNotice={setRefreshNotice}
        radixVariant="outline"
        customValidation={customValidation}
        onSuccess={onSuccess}
        onSnapshotRefreshBlocked={onSnapshotRefreshBlocked}
        experimentSnapshotTrackingProps={experimentSnapshotTrackingProps}
        fullRefreshRequired={fullRefreshRequired}
        fullRefreshReasons={fullRefreshReasons}
        newMetricsUpdate={newMetricsUpdate}
        disabled={disabled}
      />
    );
  }

  if (entityType === "safe-rollout" && safeRollout) {
    return (
      <SafeRolloutRefreshSnapshotButton
        mutate={mutate}
        safeRollout={safeRollout}
        customValidation={customValidation}
      />
    );
  }

  return null;
}

function RefreshRunQueriesButton<T extends RefreshResultsModel>({
  entityType,
  entityId,
  latest,
  mutate,
  mutateAdditional,
  setRefreshError,
  setRefreshNotice,
  experimentSnapshotTrackingProps,
  onSuccess,
  customValidation,
  onSnapshotRefreshBlocked,
  experiment,
  phase,
  dimension,
  fullRefreshRequired,
  fullRefreshReasons,
  newMetricsUpdate,
  disabled = false,
}: RefreshResultsButtonProps<T> & {
  latest: T;
  fullRefreshRequired: boolean;
  fullRefreshReasons: string[];
}) {
  const { apiCall } = useAuth();
  const { submitUpdate, fullRefreshConfirm } = useExperimentSnapshotUpdate({
    experiment,
    phase: phase ?? 0,
    dimension,
    mutate,
    mutateAdditional,
    setRefreshError,
    setRefreshNotice,
    onSuccess,
    customValidation,
    onSnapshotRefreshBlocked,
    experimentSnapshotTrackingProps,
  });

  const cancelEndpoint =
    entityType === "safe-rollout"
      ? `/safe-rollout/snapshot/${latest.id}/cancel`
      : `/snapshot/${latest.id}/cancel`;

  const snapshotEndpoint =
    entityType === "safe-rollout"
      ? `/safe-rollout/${entityId}/snapshot`
      : `/experiment/${entityId}/snapshot`;

  const runSafeRolloutUpdate = async () => {
    try {
      await apiCall<{ snapshot: SafeRolloutSnapshotInterface }>(
        snapshotEndpoint,
        { method: "POST" },
      );
      onSuccess?.();
      setRefreshError("");
    } catch (e) {
      setRefreshError(e.message);
    } finally {
      mutate();
      mutateAdditional?.();
    }
  };

  const ctaLabel = fullRefreshRequired ? "Full Refresh" : "Update";
  const handleSubmit =
    entityType === "safe-rollout"
      ? runSafeRolloutUpdate
      : fullRefreshRequired
        ? () => submitUpdate({ force: true, fullRefreshReasons })
        : () => submitUpdate();

  if (
    newMetricsUpdate &&
    entityType !== "safe-rollout" &&
    getQueryStatus(latest.queries || []).status !== "running"
  ) {
    return (
      <>
        <FullRefreshRequiredDialog controller={fullRefreshConfirm} />
        <NewMetricsUpdateButton
          onUpdateNewMetrics={() => submitUpdate({ newMetricsOnly: true })}
          onUpdateAllMetrics={() => submitUpdate()}
          disabled={disabled}
        />
      </>
    );
  }

  return (
    <>
      <FullRefreshRequiredDialog controller={fullRefreshConfirm} />
      <RunQueriesButton
        cta={ctaLabel}
        cancelEndpoint={cancelEndpoint}
        mutate={() => {
          mutate();
          mutateAdditional?.();
        }}
        model={{
          queries: latest.queries || [],
          runStarted: latest.runStarted ?? null,
        }}
        icon="refresh"
        radixVariant="outline"
        onSubmit={handleSubmit}
        disabled={disabled}
      />
    </>
  );
}
