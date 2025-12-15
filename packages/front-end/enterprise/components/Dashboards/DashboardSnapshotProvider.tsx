import React, {
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  getBlockSnapshotAnalysis,
  getBlockAnalysisSettings,
  snapshotSatisfiesBlock,
} from "shared/enterprise";
import { getSnapshotAnalysis, isDefined, isString } from "shared/util";
import { DashboardInterface } from "back-end/src/enterprise/validators/dashboard";
import { Queries, QueryStatus } from "back-end/types/query";
import { SavedQuery } from "shared/validators";
import {
  CreateMetricAnalysisProps,
  MetricAnalysisInterface,
} from "back-end/types/metric-analysis";
import { getValidDate } from "shared/dates";
import { isEqual } from "lodash";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";

export const DashboardSnapshotContext = React.createContext<{
  experiment?: ExperimentInterfaceStringDates;
  projects?: string[];
  defaultSnapshot?: ExperimentSnapshotInterface;
  dimensionless?: ExperimentSnapshotInterface;
  snapshotsMap: Map<string, ExperimentSnapshotInterface>;
  savedQueriesMap: Map<string, SavedQuery>;
  metricAnalysesMap: Map<string, MetricAnalysisInterface>;
  loading?: boolean;
  error?: Error;
  refreshStatus: QueryStatus;
  refreshError?: string; // Error from hitting the backend to start refreshing snapshots
  snapshotError?: string; // Error from the resulting snapshots after the refresh request succeeded
  allQueries: Queries;
  mutateSnapshot: () => Promise<unknown>;
  mutateSnapshotsMap: () => Promise<unknown>;
  updateAllSnapshots: () => Promise<unknown>;
}>({
  refreshStatus: "succeeded",
  snapshotsMap: new Map(),
  savedQueriesMap: new Map(),
  metricAnalysesMap: new Map(),
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
  experiment?: ExperimentInterfaceStringDates;
  dashboard?: DashboardInterface;
  mutateDefinitions: () => void;
  children: ReactNode;
}) {
  const { apiCall } = useAuth();
  const {
    data: snapshotData,
    error: singleSnapshotError,
    isLoading: snapshotLoading,
    mutate: mutateDefaultSnapshot,
  } = useApi<{
    snapshot: ExperimentSnapshotInterface;
    dimensionless: ExperimentSnapshotInterface;
  }>(
    `/experiment/${experiment?.id}/snapshot/${(experiment?.phases.length ?? 0) - 1}`,
    {
      shouldRun: () => !!experiment?.id,
    },
  );
  const [refreshError, setRefreshError] = useState<string | undefined>(
    undefined,
  );

  const {
    data: allSnapshotsData,
    error: allSnapshotsError,
    isLoading: allSnapshotsLoading,
    mutate: mutateAllSnapshots,
  } = useApi<{
    snapshots: ExperimentSnapshotInterface[];
    savedQueries: SavedQuery[];
    metricAnalyses: MetricAnalysisInterface[];
  }>(`/dashboards/${dashboard?.id}/snapshots`, {
    shouldRun: () => !!dashboard?.id && dashboard.id !== "new",
  });

  const { mutate: mutateSavedQueries } = useApi(`/saved-queries/`);

  const {
    savedQueriesMap,
    metricAnalysesMap,
    runningMetricAnalyses,
    status,
    snapshotsMap,
    allQueries,
    snapshotError,
  } = useMemo(() => {
    const allSnapshots = allSnapshotsData?.snapshots || [];
    const allSavedQueries = allSnapshotsData?.savedQueries || [];
    const allMetricAnalyses = allSnapshotsData?.metricAnalyses || [];
    const savedQueriesMap = new Map(
      allSavedQueries.map((savedQuery) => [savedQuery.id, savedQuery]),
    );
    const metricAnalysesMap = new Map(
      allMetricAnalyses.map((metricAnalysis) => [
        metricAnalysis.id,
        metricAnalysis,
      ]),
    );
    const runningMetricAnalyses = allMetricAnalyses.filter((metricAnalysis) =>
      ["running", "queued"].includes(metricAnalysis.status),
    );
    const snapshotsMap = new Map(allSnapshots.map((snap) => [snap.id, snap]));
    const allQueries = allSnapshots
      .filter(
        (snap) =>
          !dashboard ||
          dashboard.blocks.some((block) => block.snapshotId === snap.id),
      )
      .flatMap((snapshot) => snapshot.queries || [])
      .concat(
        allMetricAnalyses.flatMap(
          (metricAnalysis) => metricAnalysis.queries || [],
        ),
      );
    const snapshotError = allSnapshots.find(
      (snapshot) => snapshot.error,
    )?.error;
    const { status } = getQueryStatus(allQueries, snapshotError);

    return {
      savedQueriesMap,
      metricAnalysesMap,
      runningMetricAnalyses,
      status,
      snapshotsMap,
      allQueries,
      snapshotError,
    };
  }, [allSnapshotsData, dashboard]);

  useEffect(() => {
    const dashboardSnapshotIds = [
      ...new Set(
        (dashboard?.blocks?.map((block) => block.snapshotId) || []).filter(
          isDefined,
        ),
      ),
    ];
    if (dashboardSnapshotIds.some((snapId) => !snapshotsMap.has(snapId))) {
      mutateAllSnapshots();
    }
  }, [snapshotsMap, dashboard, mutateAllSnapshots]);

  // Refetch snapshots/metric analyses when blocks change (for existing dashboards)
  const prevBlocksRef = useRef<DashboardInterface["blocks"] | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!dashboard || dashboard.id === "new") {
      prevBlocksRef.current = dashboard?.blocks;
      return;
    }

    // Only refetch if blocks actually changed (not just a new array reference)
    if (
      prevBlocksRef.current !== undefined &&
      !isEqual(prevBlocksRef.current, dashboard.blocks)
    ) {
      mutateAllSnapshots();
    }
    prevBlocksRef.current = dashboard.blocks;
  }, [dashboard, mutateAllSnapshots]);

  // Periodically check for the status of all snapshots
  useEffect(() => {
    const intervalId = setInterval(async () => {
      if (runningMetricAnalyses.length > 0) {
        // Refresh the query status of all analyses before mutating
        for (const m of runningMetricAnalyses) {
          await apiCall(`/metric-analysis/${m.id}/refreshStatus`, {
            method: "POST",
          });
        }
      }
      if (status === "running") {
        mutateAllSnapshots();
      } else {
        clearInterval(intervalId);
      }
    }, 2000);
    return () => {
      clearInterval(intervalId);
    };
  }, [mutateAllSnapshots, status, runningMetricAnalyses, apiCall]);

  const updateAllSnapshots = async () => {
    if (!dashboard || dashboard.id === "new") return;
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
        projects:
          dashboard?.projects ??
          (experiment?.project ? [experiment.project] : undefined),
        defaultSnapshot: snapshotData?.snapshot,
        dimensionless: snapshotData?.dimensionless,
        snapshotsMap,
        savedQueriesMap,
        metricAnalysesMap,
        error: singleSnapshotError || allSnapshotsError,
        loading: snapshotLoading || allSnapshotsLoading,
        refreshStatus: status,
        refreshError,
        snapshotError,
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
  >,
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
  const [postSnapshotAnalysisLoading, setPostSnapshotAnalysisLoading] =
    useState(false);
  const [fetchingSnapshot, setFetchingSnapshot] = useState(false);
  const [fetchingSnapshotFailed, setFetchingSnapshotFailed] = useState(false);

  const blockSnapshotId = block?.snapshotId;
  const blockSnapshot = snapshotsMap.get(blockSnapshotId ?? "");

  const snapshot =
    isDefined(blockSnapshotId) && blockSnapshotId.length > 0
      ? blockSnapshot
      : defaultSnapshot;
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
  const snapshotSettingsMatch =
    snapshot && block ? snapshotSatisfiesBlock(snapshot, block) : true;

  const analysis = useMemo(() => {
    if (!snapshot || !block) return null;
    return getBlockSnapshotAnalysis(snapshot, block);
  }, [snapshot, block]);

  // If the current snapshot is incorrect, e.g. a dimension mismatch, fetch a matching snapshot
  useEffect(() => {
    if (
      !block ||
      !setBlock ||
      !experiment ||
      !snapshot ||
      snapshotSettingsMatch ||
      fetchingSnapshot ||
      fetchingSnapshotFailed
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
        }/${dimension}`,
      );
      if (!res.snapshot) {
        setFetchingSnapshotFailed(true);
      } else {
        setBlock({ ...block, snapshotId: res.snapshot.id });
      }
      setFetchingSnapshot(false);
    };
    getNewSnapshot();
  }, [
    experiment,
    snapshot,
    snapshotSettingsMatch,
    fetchingSnapshot,
    fetchingSnapshotFailed,
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
      snapshot.status === "running" ||
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

export function useDashboardMetricAnalysis(
  block: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
  setBlock:
    | undefined
    | React.Dispatch<DashboardBlockInterfaceOrData<DashboardBlockInterface>>,
) {
  const {
    loading: contextLoading,
    error: contextError,
    mutateSnapshotsMap: mutateAnalysesMap,
    metricAnalysesMap,
  } = useContext(DashboardSnapshotContext);
  const { apiCall } = useAuth();
  const [postError, setPostError] = useState<string | undefined>(undefined);
  const [postLoading, setPostLoading] = useState(false);

  const blockHasMetricAnalysis = blockHasFieldOfType(
    block,
    "metricAnalysisId",
    isString,
  );

  const metricAnalysisFromMap = useMemo(
    () =>
      blockHasMetricAnalysis
        ? metricAnalysesMap.get(block.metricAnalysisId)
        : undefined,
    [blockHasMetricAnalysis, block, metricAnalysesMap],
  );

  const shouldFetchMetricAnalysis = useCallback(
    () =>
      blockHasMetricAnalysis &&
      block.metricAnalysisId.length > 0 &&
      !metricAnalysisFromMap,
    [metricAnalysisFromMap, blockHasMetricAnalysis, block],
  );
  const {
    data: existingMetricAnalysisData,
    error: existingMetricAnalysisError,
    isLoading: getMetricAnalysisLoading,
    mutate: mutateSingleAnalysis,
  } = useApi<{
    status: number;
    metricAnalysis: MetricAnalysisInterface;
  }>(
    `/metric-analysis/${blockHasMetricAnalysis ? block.metricAnalysisId : ""}`,
    {
      shouldRun: shouldFetchMetricAnalysis,
    },
  );

  const metricAnalysis = useMemo(
    () => metricAnalysisFromMap ?? existingMetricAnalysisData?.metricAnalysis,
    [metricAnalysisFromMap, existingMetricAnalysisData],
  );

  useEffect(() => {
    const intervalId = setInterval(async () => {
      if (
        // If using manually fetched analysis & it's still running, update it on an interval
        shouldFetchMetricAnalysis() &&
        metricAnalysis &&
        ["running", "queued"].includes(
          getQueryStatus(metricAnalysis.queries, metricAnalysis.error).status,
        )
      ) {
        await apiCall(`/metric-analysis/${metricAnalysis.id}/refreshStatus`, {
          method: "POST",
        });
        mutateSingleAnalysis();
      } else {
        clearInterval(intervalId);
      }
    }, 2000);
    return () => {
      clearInterval(intervalId);
    };
  }, [
    metricAnalysis,
    mutateSingleAnalysis,
    shouldFetchMetricAnalysis,
    apiCall,
  ]);

  // Create a hook for refreshing, either due to settings changes or based on manual interaction
  const refreshAnalysis = useCallback(async () => {
    if (!setBlock) return;
    if (
      !blockHasMetricAnalysis ||
      !block.factMetricId ||
      !block.analysisSettings.userIdType
    )
      return;
    const body: CreateMetricAnalysisProps = {
      id: block.factMetricId,
      userIdType: block.analysisSettings.userIdType,
      lookbackDays: block.analysisSettings.lookbackDays,
      startDate: getValidDate(block.analysisSettings.startDate).toISOString(),
      endDate: getValidDate(block.analysisSettings.endDate).toISOString(),
      populationType: block.analysisSettings.populationType,
      populationId: block.analysisSettings.populationId || null,
      force: true,
      source: "metric",
      additionalNumeratorFilters:
        block.analysisSettings.additionalNumeratorFilters,
      additionalDenominatorFilters:
        block.analysisSettings.additionalDenominatorFilters,
    };

    setPostLoading(true);
    setPostError(undefined);
    try {
      const response = await apiCall<{
        metricAnalysis: MetricAnalysisInterface;
      }>(`/metric-analysis`, {
        method: "POST",
        body: JSON.stringify(body),
      });

      setBlock({ ...block, metricAnalysisId: response.metricAnalysis.id });
      mutateAnalysesMap();
    } catch (e) {
      setPostError(e.message);
    } finally {
      setPostLoading(false);
    }
  }, [setBlock, blockHasMetricAnalysis, block, apiCall, mutateAnalysesMap]);

  useEffect(() => {
    if (
      !blockHasMetricAnalysis ||
      postLoading ||
      getMetricAnalysisLoading ||
      ["queued", "running"].includes(metricAnalysis?.status ?? "")
    )
      return;

    if (metricAnalysis) {
      const blockSettings = {
        ...block.analysisSettings,
        startDate: getValidDate(block.analysisSettings.startDate),
        endDate: getValidDate(block.analysisSettings.endDate),
        populationId: block.analysisSettings.populationId || "",
        additionalNumeratorFilters:
          block.analysisSettings.additionalNumeratorFilters ?? [],
        additionalDenominatorFilters:
          block.analysisSettings.additionalDenominatorFilters ?? [],
      };
      const metricAnalysisSettings = {
        ...metricAnalysis.settings,
        startDate: getValidDate(metricAnalysis.settings.startDate),
        endDate: getValidDate(metricAnalysis.settings.endDate),
        populationId: metricAnalysis.settings.populationId || "",
        additionalNumeratorFilters:
          metricAnalysis.settings.additionalNumeratorFilters ?? [],
        additionalDenominatorFilters:
          metricAnalysis.settings.additionalDenominatorFilters ?? [],
      };
      // Check if analysisSettings match (including filters)
      if (isEqual(blockSettings, metricAnalysisSettings)) {
        return; // Skip refresh if everything matches
      }
    }

    refreshAnalysis();
  }, [
    block,
    blockHasMetricAnalysis,
    metricAnalysis,
    postLoading,
    getMetricAnalysisLoading,
    refreshAnalysis,
  ]);

  return {
    metricAnalysis,
    refreshAnalysis,
    loading: getMetricAnalysisLoading || contextLoading || postLoading,
    error: contextError || existingMetricAnalysisError || postError,
    mutate: shouldFetchMetricAnalysis()
      ? mutateSingleAnalysis
      : mutateAnalysesMap,
  };
}
