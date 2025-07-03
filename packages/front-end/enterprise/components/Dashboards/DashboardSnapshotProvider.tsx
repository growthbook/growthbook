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
} from "shared/enterprise";
import { getSnapshotAnalysis } from "shared/util";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";

const DashboardSnapshotContext = React.createContext<{
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
  block: DashboardBlockData<DashboardBlockInterface>
) {
  const {
    defaultSnapshot,
    loading: defaultLoading,
    error: defaultError,
    mutateSnapshot: mutateDefault,
  } = useContext(DashboardSnapshotContext);
  const { apiCall } = useAuth();
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

  console.log("Block settings are", blockAnalysisSettings);

  const analysis = useMemo(() => {
    if (!snapshot || !blockAnalysisSettings) return undefined;
    return getSnapshotAnalysis(snapshot, blockAnalysisSettings);
  }, [blockAnalysisSettings, snapshot]);

  console.log("Got analysis?", !!analysis);

  useEffect(() => {
    if (!snapshot || !blockAnalysisSettings) return;
    if (!analysis && !snapshotLoading) {
      const updateAnalysis = async () => {
        setPostSnapshotLoading(true);
        console.log("Going to update analysis", blockAnalysisSettings);
        await apiCall(`/snapshot/${snapshot.id}/analysis`, {
          method: "POST",
          body: JSON.stringify({
            analysisSettings: blockAnalysisSettings,
          }),
        });
        mutateSnapshot();
        setPostSnapshotLoading(false);
      };
      updateAnalysis();
    }
  }, [
    analysis,
    apiCall,
    blockAnalysisSettings,
    snapshot,
    snapshotLoading,
    mutateSnapshot,
  ]);

  return {
    snapshot,
    analysis,
    analysisSettings: analysis?.settings,
    loading: postSnapshotLoading || getSnapshotLoading,
    error,
    mutateSnapshot,
  };
}
