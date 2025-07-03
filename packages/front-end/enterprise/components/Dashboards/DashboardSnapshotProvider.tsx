import React, {
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {
  DashboardBlockData,
  DashboardBlockInterface,
} from "back-end/src/enterprise/validators/dashboard-block";
import {
  blockHasFieldOfType,
  getBlockAnalysisSettings,
  getBlockSnapshotSettings,
} from "shared/enterprise";
import { getSnapshotAnalysis } from "shared/util";
import { isEqual } from "lodash";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";

const DashboardSnapshotContext = React.createContext<{
  experiment?: ExperimentInterfaceStringDates;
  defaultSnapshot?: ExperimentSnapshotInterface;
  mutateSnapshot: () => Promise<unknown>;
  loading?: boolean;
  error?: Error;
}>({
  mutateSnapshot: async () => {},
});

export default function DashboardSnapshotProvider({
  experiment,
  children,
}: {
  experiment: ExperimentInterfaceStringDates;
  children: ReactNode;
}) {
  const {
    data: snapshotData,
    error: snapshotError,
    isLoading,
    mutate: snapshotMutate,
  } = useApi<{
    snapshot: ExperimentSnapshotInterface;
  }>(
    `/experiment/${experiment.id}/snapshot/${
      experiment.phases?.length - 1 || 0
    }`
  );

  return (
    <DashboardSnapshotContext.Provider
      value={{
        experiment,
        defaultSnapshot: snapshotData?.snapshot,
        mutateSnapshot: async () => {
          snapshotMutate();
        },
        error: snapshotError,
        loading: isLoading,
      }}
    >
      {children}
    </DashboardSnapshotContext.Provider>
  );
}

export function useDashboardSnapshot(
  block: DashboardBlockData<DashboardBlockInterface>,
  setBlock: React.Dispatch<DashboardBlockData<DashboardBlockInterface>>
) {
  const {
    experiment,
    defaultSnapshot,
    loading: defaultLoading,
    error: defaultError,
    mutateSnapshot: mutateDefault,
  } = useContext(DashboardSnapshotContext);
  const { apiCall } = useAuth();
  const [
    postSnapshotAnalysisLoading,
    setPostSnapshotAnalysisLoading,
  ] = useState(false);
  const [postSnapshotLoading, setPostSnapshotLoading] = useState(false);

  const blockSnapshotId = blockHasFieldOfType(
    block,
    "snapshotId",
    (val: unknown) => typeof val === "string"
  )
    ? block.snapshotId
    : "";

  const shouldRun = () => !!blockSnapshotId;

  const {
    data: blockSnapshotData,
    isLoading: snapshotLoading,
    error: snapshotError,
    mutate,
  } = useApi<{
    snapshot: ExperimentSnapshotInterface;
  }>(`/snapshot/${blockSnapshotId}`, {
    shouldRun,
  });

  const snapshot = shouldRun() ? blockSnapshotData?.snapshot : defaultSnapshot;
  const getSnapshotLoading = shouldRun() ? snapshotLoading : defaultLoading;
  const error = shouldRun() ? snapshotError : defaultError;
  const mutateSnapshot = shouldRun() ? mutate : mutateDefault;

  const blockAnalysisSettings = useMemo(() => {
    if (!snapshot) return undefined;
    const defaultAnalysis = getSnapshotAnalysis(snapshot);
    if (!defaultAnalysis) return undefined;
    return getBlockAnalysisSettings(block, defaultAnalysis.settings);
  }, [snapshot, block]);

  // Check that the current snapshot is sufficient for the block
  let snapshotSettingsMatch = true;
  if (snapshot) {
    const blockSettings = {
      ...snapshot.settings,
      ...getBlockSnapshotSettings(block),
    };
    snapshotSettingsMatch = isEqual(blockSettings, snapshot.settings);
  }

  const analysis = useMemo(() => {
    if (!snapshot || !blockAnalysisSettings) return undefined;
    return getSnapshotAnalysis(snapshot, blockAnalysisSettings);
  }, [blockAnalysisSettings, snapshot]);

  // If the current snapshot is incorrect, e.g. a dimension mismatch, post to create a new snapshot
  useEffect(() => {
    if (
      !experiment ||
      !snapshot ||
      snapshotSettingsMatch ||
      postSnapshotLoading
    )
      return;
    const createSnapshot = async () => {
      const dimension = blockHasFieldOfType(
        block,
        "dimensionId",
        (val: unknown) => typeof val === "string"
      )
        ? block.dimensionId
        : undefined;
      setPostSnapshotLoading(true);
      const res = await apiCall<{ snapshot: ExperimentSnapshotInterface }>(
        `/experiment/${experiment.id}/snapshot/`,
        {
          method: "POST",
          body: JSON.stringify({
            phase: snapshot.phase,
            dimension,
          }),
        }
      );
      setBlock({ ...block, snapshotId: res.snapshot.id });
      mutateSnapshot();
      setPostSnapshotLoading(false);
    };
    createSnapshot();
  }, [
    experiment,
    snapshot,
    snapshotSettingsMatch,
    postSnapshotLoading,
    apiCall,
    block,
    setBlock,
    mutateSnapshot,
  ]);

  // If unable to get the necessary analysis on the current snapshot, post the updated settings
  useEffect(() => {
    if (
      !snapshot ||
      !blockAnalysisSettings ||
      !snapshotSettingsMatch ||
      analysis ||
      snapshotLoading
    )
      return;
    const updateAnalysis = async () => {
      setPostSnapshotAnalysisLoading(true);
      await apiCall(`/snapshot/${snapshot.id}/analysis`, {
        method: "POST",
        body: JSON.stringify({
          analysisSettings: blockAnalysisSettings,
        }),
      });
      mutateSnapshot();
      setPostSnapshotAnalysisLoading(false);
    };
    updateAnalysis();
  }, [
    analysis,
    apiCall,
    blockAnalysisSettings,
    snapshotSettingsMatch,
    snapshot,
    snapshotLoading,
    mutateSnapshot,
  ]);

  return {
    snapshot,
    analysis,
    analysisSettings: analysis?.settings,
    loading: postSnapshotAnalysisLoading || getSnapshotLoading,
    pendingResults: snapshot?.status === "running",
    error,
    mutateSnapshot,
  };
}
