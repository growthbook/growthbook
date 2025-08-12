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
import { getSnapshotAnalysis, isDefined, isString } from "shared/util";
import { isEqual } from "lodash";
import { DashboardInterface } from "back-end/src/enterprise/validators/dashboard";
import { Queries, QueryStatus } from "back-end/types/query";
import { SavedQuery } from "back-end/src/validators/saved-queries";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";

export const DashboardSnapshotContext = React.createContext<{
  experiment?: ExperimentInterfaceStringDates;
  defaultSnapshot?: ExperimentSnapshotInterface;
  snapshotsMap: Map<string, ExperimentSnapshotInterface>;
  savedQueriesMap: Map<string, SavedQuery>;
  loading?: boolean;
  error?: Error;
  refreshStatus: QueryStatus;
  refreshError?: string;
  allQueries: Queries;
  mutateSnapshot: () => Promise<unknown>;
  mutateSnapshotsMap: () => Promise<unknown>;
  updateAllSnapshots: () => Promise<unknown>;
}>({
  refreshStatus: "succeeded",
  snapshotsMap: new Map(),
  savedQueriesMap: new Map(),
  allQueries: [],
  mutateSnapshot: async () => {},
  mutateSnapshotsMap: async () => {},
  updateAllSnapshots: async () => {},
});

export default function DashboardSnapshotProvider({
  experiment,
  dashboard,
  mutateDefinitions,
  children,
}: {
  experiment: ExperimentInterfaceStringDates;
  dashboard?: DashboardInterface;
  mutateDefinitions: () => void;
  children: ReactNode;
}) {
  const { apiCall } = useAuth();
  const {
    data: snapshotData,
    error: snapshotError,
    isLoading: snapshotLoading,
    mutate: mutateDefaultSnapshot,
  } = useApi<{
    snapshot: ExperimentSnapshotInterface;
  }>(`/experiment/${experiment.id}/snapshot/${experiment.phases.length - 1}`);
  const [refreshError, setRefreshError] = useState<string | undefined>(
    undefined
  );

  const {
    data: allSnapshotsData,
    error: allSnapshotsError,
    isLoading: allSnapshotsLoading,
    mutate: mutateAllSnapshots,
  } = useApi<{
    snapshots: ExperimentSnapshotInterface[];
    savedQueries: SavedQuery[];
  }>(`/dashboards/${dashboard?.id}/snapshots`, {
    shouldRun: () => !!dashboard?.id,
  });

  const { mutate: mutateSavedQueries } = useApi(`/saved-queries/`);

  const [allSnapshots, allSavedQueries] = useMemo(
    () => [
      allSnapshotsData?.snapshots || [],
      allSnapshotsData?.savedQueries || [],
    ],
    [allSnapshotsData]
  );

  const savedQueriesMap = useMemo(
    () =>
      new Map(allSavedQueries.map((savedQuery) => [savedQuery.id, savedQuery])),
    [allSavedQueries]
  );

  const { status, snapshotsMap, allQueries } = useMemo(() => {
    const snapshotsMap = new Map(allSnapshots.map((snap) => [snap.id, snap]));
    const allQueries = allSnapshots.flatMap(
      (snapshot) => snapshot.queries || []
    );
    const { status } = getQueryStatus(allQueries);
    return { status, snapshotsMap, allQueries };
  }, [allSnapshots]);

  useEffect(() => {
    const dashboardSnapshotIds = [
      ...new Set(
        (dashboard?.blocks?.map((block) => block.snapshotId) || []).filter(
          isDefined
        )
      ),
    ];
    if (dashboardSnapshotIds.some((snapId) => !snapshotsMap.has(snapId))) {
      mutateAllSnapshots();
    }
  }, [snapshotsMap, dashboard, mutateAllSnapshots]);

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

  const updateAllSnapshots = async () => {
    if (!dashboard) return;
    setRefreshError(undefined);
    try {
      await apiCall(`/dashboards/${dashboard.id}/refresh`, {
        method: "POST",
      });
    } catch (e) {
      setRefreshError(e.message);
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
        savedQueriesMap,
        error: snapshotError || allSnapshotsError,
        loading: snapshotLoading || allSnapshotsLoading,
        refreshStatus: status,
        refreshError,
        allQueries,
        mutateSnapshot: mutateDefaultSnapshot,
        mutateSnapshotsMap: mutateAllSnapshots,
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
    loading: snapshotsLoading,
    error: snapshotsError,
    mutateSnapshot: mutateDefault,
    mutateSnapshotsMap: mutateSnapshotsMap,
    snapshotsMap,
  } = useContext(DashboardSnapshotContext);

  const { apiCall } = useAuth();
  const [
    postSnapshotAnalysisLoading,
    setPostSnapshotAnalysisLoading,
  ] = useState(false);
  const [fetchingSnapshot, setFetchingSnapshot] = useState(false);

  const blockSnapshotId = block?.snapshotId;
  const blockSnapshot = snapshotsMap.get(blockSnapshotId ?? "");

  const snapshot = isDefined(blockSnapshotId) ? blockSnapshot : defaultSnapshot;
  const mutateSnapshot = isDefined(blockSnapshotId)
    ? mutateSnapshotsMap
    : mutateDefault;

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
    if (!snapshot || !blockAnalysisSettings) return null;
    return getSnapshotAnalysis(snapshot, blockAnalysisSettings);
  }, [blockAnalysisSettings, snapshot]);

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
  ]);

  // If unable to get the necessary analysis on the current snapshot, post the updated settings
  useEffect(() => {
    if (
      !snapshot ||
      !blockAnalysisSettings ||
      !snapshotSettingsMatch ||
      analysis ||
      snapshotsLoading
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
    snapshotsLoading,
    mutateSnapshot,
  ]);

  return {
    snapshot,
    analysis,
    loading:
      postSnapshotAnalysisLoading ||
      snapshotsLoading ||
      snapshot?.status === "running",
    error: snapshotsError,
    mutateSnapshot,
  };
}
