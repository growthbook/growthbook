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
  DashboardBlockInterfaceOrData,
  DashboardBlockInterface,
} from "back-end/src/enterprise/validators/dashboard-block";
import {
  blockHasFieldOfType,
  getBlockAnalysisSettings,
  getBlockSnapshotSettings,
} from "shared/enterprise";
import { getSnapshotAnalysis, isDefined } from "shared/util";
import { isEqual } from "lodash";
import { DashboardInstanceInterface } from "back-end/src/enterprise/validators/dashboard-instance";
import { isString } from "back-end/src/util/types";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";

export const DashboardSnapshotContext = React.createContext<{
  experiment?: ExperimentInterfaceStringDates;
  defaultSnapshot?: ExperimentSnapshotInterface;
  snapshotsMap?: Map<string, ExperimentSnapshotInterface>;
  mutateSnapshot: () => Promise<unknown>;
  loading?: boolean;
  validating?: boolean;
  error?: Error;
  refreshing?: boolean;
  numQueries: number;
  numFinished: number;
  updateAllSnapshots: () => Promise<unknown>;
}>({
  numQueries: 0,
  numFinished: 0,
  mutateSnapshot: async () => {},
  updateAllSnapshots: async () => {},
});

export default function DashboardSnapshotProvider({
  experiment,
  dashboard,
  mutateDefinitions,
  children,
}: {
  experiment: ExperimentInterfaceStringDates;
  dashboard?: DashboardInstanceInterface;
  mutateDefinitions: () => void;
  children: ReactNode;
}) {
  const [updatingDashboardSnapshots, setUpdatingDashboardSnapshots] = useState(
    false
  );
  const { apiCall } = useAuth();
  const {
    data: snapshotData,
    error: snapshotError,
    isValidating,
    isLoading,
    mutate: mutateDefaultSnapshot,
  } = useApi<{
    snapshot: ExperimentSnapshotInterface;
  }>(`/experiment/${experiment.id}/snapshot/${experiment.phases.length - 1}`);

  const { data: allSnapshotsData, mutate: mutateAllSnapshots } = useApi<{
    snapshots: ExperimentSnapshotInterface[];
  }>(`/dashboards/${dashboard?.id}/snapshots`, {
    shouldRun: () => !!dashboard?.id,
  });

  const { mutate: mutateSavedQueries } = useApi(`/saved-queries/`);

  const allSnapshots = useMemo(() => allSnapshotsData?.snapshots || [], [
    allSnapshotsData,
  ]);

  const { status, numFinished, numQueries, snapshotsMap } = useMemo(() => {
    const snapshotsMap = new Map(allSnapshots.map((snap) => [snap.id, snap]));
    const allQueries = allSnapshots.flatMap(
      (snapshot) => snapshot.queries || []
    );
    const { status } = getQueryStatus(allQueries);
    const numFinished = allQueries.filter((q) => q.status === "succeeded")
      .length;
    const numQueries = allQueries.length;
    return { status, numFinished, numQueries, snapshotsMap };
  }, [allSnapshots]);

  // Periodically check for the status of all snapshots
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (status === "running") {
        mutateAllSnapshots();
      } else {
        clearInterval(intervalId);
      }
    }, 2000);
    return () => {
      clearInterval(intervalId);
    };
  }, [mutateAllSnapshots, status]);

  useEffect(() => {
    setUpdatingDashboardSnapshots(numFinished < numQueries);
  }, [numFinished, numQueries]);

  const updateAllSnapshots = async () => {
    if (!dashboard) return;
    setUpdatingDashboardSnapshots(true);
    try {
      await apiCall(`/dashboards/${dashboard.id}/refresh`, {
        method: "POST",
      });
    } catch {
      // TODO: surface any errors in a useful format
      setUpdatingDashboardSnapshots(false);
    } finally {
      mutateDefinitions();
      mutateDefaultSnapshot();
      mutateAllSnapshots();
      mutateSavedQueries();
    }
  };

  return (
    <DashboardSnapshotContext.Provider
      value={{
        experiment,
        defaultSnapshot: snapshotData?.snapshot,
        snapshotsMap,
        mutateSnapshot: mutateDefaultSnapshot,
        error: snapshotError,
        loading: isLoading,
        validating: isValidating,
        refreshing: updatingDashboardSnapshots,
        numQueries,
        numFinished,
        updateAllSnapshots,
      }}
    >
      {children}
    </DashboardSnapshotContext.Provider>
  );
}

export function useDashboardSnapshot(
  block?: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
  setBlock?: React.Dispatch<
    DashboardBlockInterfaceOrData<DashboardBlockInterface>
  >
) {
  const {
    experiment,
    defaultSnapshot,
    loading: defaultLoading,
    validating: defaultValidating,
    error: defaultError,
    mutateSnapshot: mutateDefault,
    refreshing,
  } = useContext(DashboardSnapshotContext);

  const [dashboardRefreshing, setDashboardRefreshing] = useState<
    boolean | undefined
  >(false);
  const { apiCall } = useAuth();
  const [
    postSnapshotAnalysisLoading,
    setPostSnapshotAnalysisLoading,
  ] = useState(false);
  const [fetchingSnapshot, setFetchingSnapshot] = useState(false);

  const blockSnapshotId = block?.snapshotId;

  const shouldRun = () =>
    isDefined(blockSnapshotId) && blockSnapshotId.length > 0;

  // TODO: maybe switch to using snapshotmap rather than making separate API calls
  const {
    data: blockSnapshotData,
    isValidating: snapshotValidating,
    isLoading: snapshotLoading,
    error: snapshotError,
    mutate,
  } = useApi<{
    snapshot: ExperimentSnapshotInterface;
  }>(`/snapshot/${blockSnapshotId}`, {
    shouldRun,
  });

  const snapshot = isDefined(blockSnapshotId)
    ? blockSnapshotData?.snapshot
    : defaultSnapshot;
  const getSnapshotLoading = isDefined(blockSnapshotId)
    ? snapshotLoading
    : defaultLoading;
  const validating = isDefined(blockSnapshotId)
    ? snapshotValidating
    : defaultValidating;
  const error = isDefined(blockSnapshotId) ? snapshotError : defaultError;
  const mutateSnapshot = isDefined(blockSnapshotId) ? mutate : mutateDefault;

  const blockAnalysisSettings = useMemo(() => {
    if (!block || !snapshot) return undefined;
    const defaultAnalysis = getSnapshotAnalysis(snapshot);
    if (!defaultAnalysis) return undefined;
    return getBlockAnalysisSettings(block, defaultAnalysis.settings);
  }, [snapshot, block]);

  // Check that the current snapshot is sufficient for the block
  let snapshotSettingsMatch = true;
  if (snapshot && block) {
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

  // If the overall dashboard just finished refreshing, mutate the local snapshot
  useEffect(() => {
    if (dashboardRefreshing && !refreshing) {
      mutateSnapshot();
    }
    setDashboardRefreshing(refreshing);
  }, [dashboardRefreshing, refreshing, mutateSnapshot]);

  // Wait for results to be ready if the snapshot is still running
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (snapshot?.status === "running") {
        mutateSnapshot();
      } else {
        clearInterval(intervalId);
      }
    }, 2000);
    return () => {
      clearInterval(intervalId);
    };
  }, [mutateSnapshot, snapshot]);

  // If the current snapshot is incorrect, e.g. a dimension mismatch, fetch a matching snapshot
  useEffect(() => {
    if (
      !block ||
      !setBlock ||
      !experiment ||
      !snapshot ||
      snapshotSettingsMatch ||
      fetchingSnapshot
    )
      return;
    const getNewSnapshot = async () => {
      const dimension = blockHasFieldOfType(block, "dimensionId", isString)
        ? block.dimensionId
        : undefined;
      setFetchingSnapshot(true);
      const res = await apiCall<{ snapshot?: ExperimentSnapshotInterface }>(
        `/experiment/${experiment.id}/snapshot/${
          experiment.phases.length - 1
        }/${dimension}`
      );
      setBlock({ ...block, snapshotId: res.snapshot?.id ?? "" });
      mutateSnapshot();
      setFetchingSnapshot(false);
    };
    getNewSnapshot();
  }, [
    experiment,
    snapshot,
    snapshotSettingsMatch,
    fetchingSnapshot,
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
    loading:
      postSnapshotAnalysisLoading ||
      getSnapshotLoading ||
      snapshot?.status === "running",
    validating,
    error,
    mutateSnapshot,
  };
}
