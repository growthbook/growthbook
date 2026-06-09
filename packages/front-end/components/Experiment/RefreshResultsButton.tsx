import React, { useState } from "react";
import { Queries } from "shared/types/query";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { isDimensionPrecomputed } from "shared/experiments";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import {
  SafeRolloutInterface,
  SafeRolloutSnapshotInterface,
} from "shared/validators";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import { getHonoredPrecomputedUnitDimensionIds } from "@/services/experiments";
import { trackSnapshot } from "@/services/track";
import RunQueriesButton from "@/components/Queries/RunQueriesButton";
import ExperimentRefreshSnapshotButton from "@/components/Experiment/RefreshSnapshotButton";
import SafeRolloutRefreshSnapshotButton from "@/components/SafeRollout/RefreshSnapshotButton";
import ConfirmDialog from "@/ui/ConfirmDialog";
import { useIncrementalRefresh } from "@/hooks/useIncrementalRefresh";

export type EntityType = "experiment" | "holdout" | "safe-rollout";

export interface RefreshResultsButtonProps<
  T extends {
    id: string;
    queries?: Queries;
    runStarted?: string | Date | null;
  },
> {
  entityType: EntityType;
  entityId: string;
  datasourceId?: string | null;
  latest?: T;
  mutate: () => void;
  mutateAdditional?: () => void;
  setRefreshError: (error: string) => void;
  experimentSnapshotTrackingProps?: {
    trackingSource: string;
    datasourceType: string | null;
  };
  onSuccess?: () => void;
  // Experiment/holdout-specific props
  experiment?: ExperimentInterfaceStringDates;
  phase?: number;
  dimension?: string;
  setAnalysisSettings?: (
    settings: ExperimentSnapshotAnalysisSettings | null,
  ) => void;
  // SafeRollout-specific props
  safeRollout?: SafeRolloutInterface;
}

export default function RefreshResultsButton<
  T extends {
    id: string;
    queries?: Queries;
    runStarted?: string | Date | null;
  },
>({
  entityType,
  entityId,
  datasourceId,
  latest,
  mutate,
  mutateAdditional,
  setRefreshError,
  experimentSnapshotTrackingProps,
  onSuccess,
  experiment,
  phase,
  dimension,
  safeRollout,
}: RefreshResultsButtonProps<T>) {
  const { apiCall } = useAuth();
  const { getDatasourceById } = useDefinitions();
  const { hasCommercialFeature } = useUser();

  const { nextUpdatePlan, mutate: mutateIncrementalRefresh } =
    useIncrementalRefresh(
      entityType === "experiment" || entityType === "holdout" ? entityId : "",
    );

  const [settingsOutdatedModalOpen, setSettingsOutdatedModalOpen] =
    useState(false);

  const hasQueries = latest?.queries && latest.queries.length > 0;

  // Determine which button to render
  const shouldUseRunQueriesButton = datasourceId && latest && hasQueries;

  const shouldRenderExperimentButton =
    !shouldUseRunQueriesButton &&
    (entityType === "experiment" || entityType === "holdout") &&
    experiment &&
    phase !== undefined;

  const shouldRenderSafeRolloutButton =
    !shouldUseRunQueriesButton &&
    !shouldRenderExperimentButton &&
    entityType === "safe-rollout" &&
    safeRollout;

  // Endpoints for the various buttons
  const cancelEndpoint =
    entityType === "safe-rollout"
      ? `/safe-rollout/snapshot/${latest?.id}/cancel`
      : `/snapshot/${latest?.id}/cancel`;

  const snapshotEndpoint =
    entityType === "safe-rollout"
      ? `/safe-rollout/${entityId}/snapshot`
      : `/experiment/${entityId}/snapshot`;

  const isSettingsOutdated =
    nextUpdatePlan?.runner === "inline" &&
    nextUpdatePlan.fallback?.code === "settings-outdated";

  const runNormalUpdate = async () => {
    const snapshotDimension = isDimensionPrecomputed(
      dimension,
      getHonoredPrecomputedUnitDimensionIds(
        experiment?.precomputedUnitDimensionIds,
        experiment?.datasource
          ? getDatasourceById(experiment.datasource)
          : undefined,
        hasCommercialFeature("pipeline-mode"),
      ),
    )
      ? ""
      : (dimension ?? "");
    const body =
      entityType === "experiment" || entityType === "holdout"
        ? JSON.stringify({
            phase: phase ?? 0,
            dimension: snapshotDimension,
          })
        : undefined;

    try {
      if (entityType === "safe-rollout") {
        await apiCall<{ snapshot: SafeRolloutSnapshotInterface }>(
          snapshotEndpoint,
          { method: "POST" },
        );
      } else {
        const res = await apiCall<{
          snapshot: ExperimentSnapshotInterface;
        }>(snapshotEndpoint, {
          method: "POST",
          ...(body && { body }),
        });
        if (experimentSnapshotTrackingProps) {
          trackSnapshot(
            "create",
            experimentSnapshotTrackingProps.trackingSource,
            experimentSnapshotTrackingProps.datasourceType,
            res.snapshot,
          );
        }
      }
      onSuccess?.();
      setRefreshError("");
    } catch (e) {
      setRefreshError(e.message);
    } finally {
      mutate();
      mutateAdditional?.();
    }
  };

  const runForceRefresh = async () => {
    try {
      await apiCall<{ snapshot: ExperimentSnapshotInterface }>(
        `${snapshotEndpoint}?force=true`,
        {
          method: "POST",
          body: JSON.stringify({ phase: phase ?? 0, dimension: "" }),
        },
      );
      onSuccess?.();
      setRefreshError("");
    } catch (e) {
      setRefreshError(e.message);
    } finally {
      mutate();
      mutateAdditional?.();
      mutateIncrementalRefresh();
    }
  };

  return (
    <>
      {settingsOutdatedModalOpen ? (
        <ConfirmDialog
          title="Rebuild incremental pipeline?"
          content={
            <div>
              The experiment settings have changed since the incremental
              pipeline was built. Updates will run as full queries and pipeline
              tables will stop advancing until you run a Full Refresh.
              <br />
              <br />
              Running a Full Refresh rebuilds the pipeline tables with the
              current settings and resumes incremental updates going forward.
            </div>
          }
          yesText="Run Full Refresh"
          noText="Update anyway"
          onConfirm={async () => {
            setSettingsOutdatedModalOpen(false);
            await runForceRefresh();
          }}
          onCancel={async () => {
            setSettingsOutdatedModalOpen(false);
            await runNormalUpdate();
          }}
        />
      ) : null}
      {shouldUseRunQueriesButton ? (
        <RunQueriesButton
          cta="Update"
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
          useRadixButton={true}
          radixVariant="outline"
          onSubmit={async () => {
            if (isSettingsOutdated && !dimension) {
              setSettingsOutdatedModalOpen(true);
              return;
            }
            await runNormalUpdate();
          }}
        />
      ) : shouldRenderExperimentButton ? (
        <ExperimentRefreshSnapshotButton
          mutate={() => {
            mutate();
            mutateAdditional?.();
          }}
          phase={phase}
          experiment={experiment}
          dimension={dimension}
          setError={(error) => setRefreshError(error ?? "")}
          useRadixButton={true}
          radixVariant="outline"
        />
      ) : shouldRenderSafeRolloutButton ? (
        <SafeRolloutRefreshSnapshotButton
          mutate={mutate}
          safeRollout={safeRollout}
        />
      ) : null}
    </>
  );
}
