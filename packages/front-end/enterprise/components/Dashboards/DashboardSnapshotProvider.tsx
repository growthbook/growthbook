import React, {
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  DashboardBlockInterfaceOrData,
  DashboardBlockInterface,
  blockHasFieldOfType,
  getBlockSnapshotAnalysis,
  getBlockAnalysisSettings,
  snapshotSatisfiesBlock,
  resolveBlockComparison,
  DashboardInterface,
} from "shared/enterprise";
import { getSnapshotAnalysis, isDefined, isString } from "shared/util";
import { Queries, QueryStatus } from "shared/types/query";
import { ProductAnalyticsExploration, SavedQuery } from "shared/validators";
import {
  CreateMetricAnalysisProps,
  MetricAnalysisInterface,
} from "shared/types/metric-analysis";
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
  mutateDefinitions: () => Promise<unknown> | void;
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
    explorations: ProductAnalyticsExploration[];
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
    const allExplorations = allSnapshotsData?.explorations || [];
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
      )
      .concat(
        allExplorations.flatMap((exploration) => exploration.queries || []),
      );
    const snapshotError: string | undefined =
      (allSnapshots.find((snapshot) => snapshot.error)?.error ||
        allMetricAnalyses.find((metricAnalysis) => metricAnalysis.error)
          ?.error ||
        allExplorations.find((exploration) => exploration.error)?.error ||
        allSavedQueries.find((q) => q.results?.error)?.results?.error) ??
      undefined;
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
      await mutateDefinitions();
      await Promise.all([
        mutateDefaultSnapshot(),
        mutateAllSnapshots(),
        mutateSavedQueries(),
      ]);
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
  // Store fetched snapshots locally for new/unsaved dashboards where snapshotsMap is empty
  const [localSnapshotsMap, setLocalSnapshotsMap] = useState<
    Map<string, ExperimentSnapshotInterface>
  >(new Map());

  // Store setBlock in a ref so we can access the latest version without it being a dependency
  const setBlockRef = useRef(setBlock);
  useEffect(() => {
    setBlockRef.current = setBlock;
  }, [setBlock]);

  const blockSnapshotId = block?.snapshotId;
  const blockSnapshot =
    snapshotsMap.get(blockSnapshotId ?? "") ||
    localSnapshotsMap.get(blockSnapshotId ?? "");

  const snapshot =
    blockSnapshotId && blockSnapshot ? blockSnapshot : defaultSnapshot;
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
      !setBlockRef.current ||
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
        const fetchedSnapshot = res.snapshot;
        // Store the snapshot locally so it can be found even on unsaved dashboards
        setLocalSnapshotsMap((prev) => {
          const newMap = new Map(prev);
          newMap.set(fetchedSnapshot.id, fetchedSnapshot);
          return newMap;
        });
        setBlockRef.current?.({ ...block, snapshotId: fetchedSnapshot.id });
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
  const [comparisonPostError, setComparisonPostError] = useState<
    string | undefined
  >(undefined);
  const [comparisonPostLoading, setComparisonPostLoading] = useState(false);

  const blockHasMetricAnalysis = blockHasFieldOfType(
    block,
    "metricAnalysisId",
    isString,
  );

  // Only metric-explorer blocks support compare-to-previous-period. Narrowing on
  // the discriminant gives us typed access to analysisSettings/comparison below
  // without conditional hooks.
  const metricExplorerBlock =
    block.type === "metric-explorer" ? block : undefined;

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

  // ---- Compare to previous period (metric-explorer only) ----
  // Resolved through the shared seam so a future dashboard-wide compare toggle
  // drives this the same way the per-block setting does today.
  const compareEnabled =
    !!metricExplorerBlock &&
    !!resolveBlockComparison({ comparison: metricExplorerBlock.comparison })
      ?.enabled;

  const comparisonMetricAnalysisId =
    metricExplorerBlock?.comparisonMetricAnalysisId;

  // The previous window is derived from the current one — an adjacent window of
  // equal length immediately preceding it. We never reserve/persist these dates;
  // they roll with whatever the block's current timeframe resolves to.
  const previousAnalysisSettings = useMemo(() => {
    if (!metricExplorerBlock) return undefined;
    const settings = metricExplorerBlock.analysisSettings;
    const curStart = getValidDate(settings.startDate);
    const curEnd = getValidDate(settings.endDate);
    const spanMs = curEnd.getTime() - curStart.getTime();
    return {
      ...settings,
      startDate: new Date(curStart.getTime() - spanMs),
      endDate: curStart,
    };
  }, [metricExplorerBlock]);

  const comparisonFromMap = useMemo(
    () =>
      comparisonMetricAnalysisId
        ? metricAnalysesMap.get(comparisonMetricAnalysisId)
        : undefined,
    [comparisonMetricAnalysisId, metricAnalysesMap],
  );

  const shouldFetchComparison = useCallback(
    () =>
      compareEnabled &&
      !!comparisonMetricAnalysisId &&
      comparisonMetricAnalysisId.length > 0 &&
      !comparisonFromMap,
    [compareEnabled, comparisonMetricAnalysisId, comparisonFromMap],
  );

  const { data: comparisonAnalysisData, mutate: mutateComparisonAnalysis } =
    useApi<{
      status: number;
      metricAnalysis: MetricAnalysisInterface;
    }>(`/metric-analysis/${comparisonMetricAnalysisId || ""}`, {
      shouldRun: shouldFetchComparison,
    });

  const comparisonMetricAnalysis = useMemo(
    () => comparisonFromMap ?? comparisonAnalysisData?.metricAnalysis,
    [comparisonFromMap, comparisonAnalysisData],
  );

  // Poll the comparison analysis while it's running, mirroring the primary.
  useEffect(() => {
    const intervalId = setInterval(async () => {
      if (
        shouldFetchComparison() &&
        comparisonMetricAnalysis &&
        ["running", "queued"].includes(
          getQueryStatus(
            comparisonMetricAnalysis.queries,
            comparisonMetricAnalysis.error,
          ).status,
        )
      ) {
        await apiCall(
          `/metric-analysis/${comparisonMetricAnalysis.id}/refreshStatus`,
          { method: "POST" },
        );
        mutateComparisonAnalysis();
      } else {
        clearInterval(intervalId);
      }
    }, 2000);
    return () => {
      clearInterval(intervalId);
    };
  }, [
    comparisonMetricAnalysis,
    mutateComparisonAnalysis,
    shouldFetchComparison,
    apiCall,
  ]);

  const refreshComparison = useCallback(async () => {
    if (!setBlock || !metricExplorerBlock || !previousAnalysisSettings) return;
    if (!compareEnabled) return;
    if (
      !metricExplorerBlock.factMetricId ||
      !previousAnalysisSettings.userIdType
    )
      return;
    const body: CreateMetricAnalysisProps = {
      id: metricExplorerBlock.factMetricId,
      userIdType: previousAnalysisSettings.userIdType,
      lookbackDays: previousAnalysisSettings.lookbackDays,
      startDate: getValidDate(previousAnalysisSettings.startDate).toISOString(),
      endDate: getValidDate(previousAnalysisSettings.endDate).toISOString(),
      populationType: previousAnalysisSettings.populationType,
      populationId: previousAnalysisSettings.populationId || null,
      force: true,
      source: "metric",
      additionalNumeratorFilters:
        previousAnalysisSettings.additionalNumeratorFilters,
      additionalDenominatorFilters:
        previousAnalysisSettings.additionalDenominatorFilters,
    };

    setComparisonPostLoading(true);
    setComparisonPostError(undefined);
    try {
      const response = await apiCall<{
        metricAnalysis: MetricAnalysisInterface;
      }>(`/metric-analysis`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setBlock({
        ...metricExplorerBlock,
        comparisonMetricAnalysisId: response.metricAnalysis.id,
      });
      mutateAnalysesMap();
    } catch (e) {
      setComparisonPostError(e.message);
    } finally {
      setComparisonPostLoading(false);
    }
  }, [
    setBlock,
    metricExplorerBlock,
    previousAnalysisSettings,
    compareEnabled,
    apiCall,
    mutateAnalysesMap,
  ]);

  // Clear a prior comparison failure when the inputs change, so the next attempt
  // (user edits settings, re-enables compare, or hits Refresh) can run again.
  useEffect(() => {
    setComparisonPostError(undefined);
  }, [compareEnabled, previousAnalysisSettings]);

  // Kick off (or refresh) the previous-period analysis whenever compare is on and
  // the cached comparison doesn't match the derived previous window.
  useEffect(() => {
    if (!metricExplorerBlock || !compareEnabled || !previousAnalysisSettings)
      return;
    // Bail while a request is in flight, the analysis is still running, or the
    // last attempt errored. Without the error guard a persistent failure
    // (warehouse down, bad metric) would re-fire one POST per render forever,
    // since comparisonPostLoading flipping back to false re-triggers this effect
    // and the isEqual short-circuit is never reached. The error is cleared above
    // when the inputs change, which is the retry path.
    if (
      comparisonPostLoading ||
      comparisonPostError ||
      ["queued", "running"].includes(comparisonMetricAnalysis?.status ?? "")
    )
      return;

    if (comparisonMetricAnalysis) {
      const desired = {
        ...previousAnalysisSettings,
        startDate: getValidDate(previousAnalysisSettings.startDate),
        endDate: getValidDate(previousAnalysisSettings.endDate),
        populationId: previousAnalysisSettings.populationId || "",
        additionalNumeratorFilters:
          previousAnalysisSettings.additionalNumeratorFilters ?? [],
        additionalDenominatorFilters:
          previousAnalysisSettings.additionalDenominatorFilters ?? [],
      };
      const existing = {
        ...comparisonMetricAnalysis.settings,
        startDate: getValidDate(comparisonMetricAnalysis.settings.startDate),
        endDate: getValidDate(comparisonMetricAnalysis.settings.endDate),
        populationId: comparisonMetricAnalysis.settings.populationId || "",
        additionalNumeratorFilters:
          comparisonMetricAnalysis.settings.additionalNumeratorFilters ?? [],
        additionalDenominatorFilters:
          comparisonMetricAnalysis.settings.additionalDenominatorFilters ?? [],
      };
      if (isEqual(desired, existing)) return;
    }

    refreshComparison();
  }, [
    metricExplorerBlock,
    compareEnabled,
    previousAnalysisSettings,
    comparisonMetricAnalysis,
    comparisonPostLoading,
    comparisonPostError,
    refreshComparison,
  ]);

  return {
    metricAnalysis,
    comparisonMetricAnalysis: compareEnabled
      ? comparisonMetricAnalysis
      : undefined,
    compareEnabled,
    refreshAnalysis,
    loading:
      getMetricAnalysisLoading ||
      contextLoading ||
      postLoading ||
      comparisonPostLoading,
    error:
      contextError ||
      existingMetricAnalysisError ||
      postError ||
      comparisonPostError,
    mutate: shouldFetchMetricAnalysis()
      ? mutateSingleAnalysis
      : mutateAnalysesMap,
  };
}
