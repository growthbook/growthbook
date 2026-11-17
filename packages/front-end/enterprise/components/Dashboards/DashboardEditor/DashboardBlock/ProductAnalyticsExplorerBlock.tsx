import { Flex } from "@radix-ui/themes";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  MetricExplorationBlockInterface,
  FactTableExplorationBlockInterface,
  DataSourceExplorationBlockInterface,
  SqlExplorationBlockInterface,
  FunnelExplorationBlockInterface,
  blockUsesDashboardDateControl,
  getEffectiveExplorationConfig,
  getExplorationDateControlFingerprint,
  resolveBlockComparison,
  resolveComparisonMode,
  getComparisonAlignmentStrategy,
  computeExplorationComparisonPayload,
  DashboardBlockInterfaceOrData,
  withRequestedDisplayConfig,
} from "shared/enterprise";
import { isEqual } from "lodash";
import {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import { QueryInterface } from "shared/types/query";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useExploreData } from "@/enterprise/components/ProductAnalytics/useExploreData";
import {
  explorationPollDelayMs,
  isTableChartType,
} from "@/enterprise/components/ProductAnalytics/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import ExplorerChart from "@/enterprise/components/ProductAnalytics/MainSection/ExplorerChart";
import ExplorerDataTable from "@/enterprise/components/ProductAnalytics/MainSection/ExplorerDataTable";
import LoadingSpinner from "@/components/LoadingSpinner";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import { BlockProps } from ".";

// Poll interval for a tile's exploration: back off while it's still running,
// stop (0) once it's terminal (success/error) or absent.
function pollDelayForExploration(
  exploration: ProductAnalyticsExploration | undefined | null,
): number {
  if (exploration?.status !== "running") return 0;
  const started = exploration.runStarted
    ? new Date(exploration.runStarted).getTime()
    : Date.now();
  return explorationPollDelayMs(Math.floor((Date.now() - started) / 1000));
}

// True when blocks render without the dashboard header and its Update button,
// so each tile offers its own.
export const DashboardHeaderlessContext = createContext(false);

// Runs a tile from its own config. With checkCache, the first load reads a
// cached result, which only needs read access. run() queries the warehouse.
// Either one stores the exploration id, and the tile's useApi request polls it
// like a saved one.
// shortcut: no comparison period; add one once the fact table page's runner lands.
function useTileRun(config: ExplorationConfig | null, checkCache: boolean) {
  const { apiCall } = useAuth();
  const { fetchData } = useExploreData();
  // Both change whenever the sign-in token refreshes, and that shouldn't
  // reset the tile, so requests read them through refs.
  const apiCallRef = useRef(apiCall);
  const fetchDataRef = useRef(fetchData);
  useEffect(() => {
    apiCallRef.current = apiCall;
    fetchDataRef.current = fetchData;
  }, [apiCall, fetchData]);
  const [explorationId, setExplorationId] = useState<string | null>(null);
  // Starts true so the empty state doesn't flash before the cache check
  const [loading, setLoading] = useState(config !== null && checkCache);
  const [error, setError] = useState<string | null>(null);
  // Callers may rebuild an equal config every render
  const configKey = config ? JSON.stringify(config) : null;

  // The config the latest request belongs to; null once unmounted.
  const latestKey = useRef<string | null>(null);

  const readCache = useCallback(async () => {
    if (!configKey) return;
    setLoading(true);
    // Stays silent: a block that isn't set up yet fails the check, and that
    // should read as no results, not an error.
    const id = await apiCallRef
      .current<{ exploration: ProductAnalyticsExploration | null }>(
        "/product-analytics/cached",
        {
          method: "POST",
          body: JSON.stringify({ config: JSON.parse(configKey) }),
        },
      )
      .then((res) => res.exploration?.id ?? null)
      .catch(() => null);
    // The config changed while this ran, so the result is for an old config.
    if (latestKey.current !== configKey) return;
    if (id) setExplorationId(id);
    setLoading(false);
  }, [configKey]);

  const run = useCallback(async () => {
    if (!configKey) return;
    setError(null);
    setLoading(true);
    const result = await fetchDataRef.current(JSON.parse(configKey), {
      cache: "preferred",
    });
    if (latestKey.current !== configKey) return;
    if (result.data?.id) setExplorationId(result.data.id);
    else if (result.error) setError(result.error);
    setLoading(false);
  }, [configKey]);

  useEffect(() => {
    latestKey.current = configKey;
    setExplorationId(null);
    setError(null);
    if (checkCache) readCache();
    else setLoading(false);
    return () => {
      latestKey.current = null;
    };
  }, [configKey, checkCache, readCache]);

  return { explorationId, loading, error, run };
}

export default function ProductAnalyticsExplorerBlock({
  block,
  dashboardGlobalControls,
  dashboardComparison,
  isEditing,
}: BlockProps<
  | MetricExplorationBlockInterface
  | FactTableExplorationBlockInterface
  | DataSourceExplorationBlockInterface
  | SqlExplorationBlockInterface
  | FunnelExplorationBlockInterface
>) {
  return (
    <ProductAnalyticsExplorerVisualization
      block={block}
      dashboardGlobalControls={dashboardGlobalControls}
      dashboardComparison={dashboardComparison}
      isEditing={isEditing}
    />
  );
}

export function ProductAnalyticsExplorerVisualization({
  block,
  dashboardGlobalControls,
  dashboardComparison,
  isEditing = false,
}: {
  block: DashboardBlockInterfaceOrData<
    | MetricExplorationBlockInterface
    | FactTableExplorationBlockInterface
    | DataSourceExplorationBlockInterface
    | SqlExplorationBlockInterface
    | FunnelExplorationBlockInterface
  >;
  dashboardGlobalControls?: BlockProps<SqlExplorationBlockInterface>["dashboardGlobalControls"];
  dashboardComparison?: BlockProps<SqlExplorationBlockInterface>["dashboardComparison"];
  isEditing?: boolean;
}) {
  const { getFactMetricById, getDatasourceById } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const headerless = useContext(DashboardHeaderlessContext);
  const dateControlledBlock = blockUsesDashboardDateControl(block)
    ? block
    : null;
  // The tile runs itself when nothing else will: a block with no stored
  // result, or any block shown without the dashboard header. While editing,
  // the sidebar runs the block. A block that follows the dashboard date
  // control runs with the dashboard's dates, or its result would read as stale.
  const runConfig = useMemo(
    () =>
      isEditing || !block.config || (block.explorerAnalysisId && !headerless)
        ? null
        : dashboardGlobalControls && dateControlledBlock
          ? getEffectiveExplorationConfig(dateControlledBlock, {
              globalControls: dashboardGlobalControls,
            })
          : block.config,
    [
      isEditing,
      block.config,
      block.explorerAnalysisId,
      headerless,
      dashboardGlobalControls,
      dateControlledBlock,
    ],
  );
  const runDatasource = runConfig
    ? getDatasourceById(runConfig.datasource)
    : null;
  const canRun =
    !!runConfig &&
    !!runDatasource &&
    permissionsUtil.canRunProductAnalyticsExplorationQueries(
      runDatasource,
      runConfig.type,
    );
  const tileRun = useTileRun(runConfig, !block.explorerAnalysisId);
  // A result the tile ran replaces the stored one.
  const explorationId = tileRun.explorationId || block.explorerAnalysisId;
  const { data, error, isLoading } = useApi<{
    status: number;
    exploration: ProductAnalyticsExploration;
    query: QueryInterface | null;
  }>(`/product-analytics/exploration/${explorationId}`, {
    shouldRun: () => !!explorationId,
    // A tile's exploration can be returned still "running" (a refresh query
    // that exceeded the ~5s sync budget keeps executing server-side). Poll on
    // a backoff until it reaches a terminal state; 0 stops the interval.
    refreshInterval: (latest) => pollDelayForExploration(latest?.exploration),
  });
  // A cache hit can have dates that only overlap the ones the tile asked for,
  // and reading it by id returns the stored dates. Show it with the requested
  // dates, as /product-analytics/run does, so it doesn't read as stale.
  const fetchedExploration = data?.exploration;
  const exploration = useMemo(
    () =>
      fetchedExploration && tileRun.explorationId && runConfig
        ? withRequestedDisplayConfig(fetchedExploration, runConfig)
        : fetchedExploration,
    [fetchedExploration, tileRun.explorationId, runConfig],
  );

  // Pass the dashboard, or a dashboard-wide comparison renders as primary-only.
  // The previous-period exploration is a separate entity produced on refresh.
  const comparison = resolveBlockComparison(block, {
    comparison: dashboardComparison,
  });
  const compareEnabled = !!comparison?.enabled;
  const comparisonMode = comparison
    ? resolveComparisonMode(comparison)
    : "previousPeriod";
  const { data: comparisonData } = useApi<{
    status: number;
    exploration: ProductAnalyticsExploration;
    query: QueryInterface | null;
  }>(`/product-analytics/exploration/${block.comparisonExplorerAnalysisId}`, {
    shouldRun: () => compareEnabled && !!block.comparisonExplorerAnalysisId,
    refreshInterval: (latest) => pollDelayForExploration(latest?.exploration),
  });
  const rawComparisonExploration = comparisonData?.exploration ?? null;
  // The resolved previous window lives on the comparison exploration's config.
  const submittedPreviousTimeFrame =
    rawComparisonExploration?.config?.dateRange ?? null;

  // Dashboard blocks fetch the saved primary + previous explorations directly,
  // bypassing POST /product-analytics/run — where the live Explorer builds its
  // comparison payload via computeExplorationComparisonPayload (densified rows +
  // trends). Recreate that payload here with the same shared helper so the
  // dashboard matches the Explorer: empty previous periods densify to zeros
  // instead of triggering the "no data, nothing to compare" message, and
  // big-number / table trends are computed identically.
  const submittedConfig = useMemo(
    () =>
      block.config && dashboardGlobalControls && dateControlledBlock
        ? getEffectiveExplorationConfig(dateControlledBlock, {
            globalControls: dashboardGlobalControls,
          })
        : (block.config ?? exploration?.config ?? null),
    [
      block.config,
      dashboardGlobalControls,
      exploration?.config,
      dateControlledBlock,
    ],
  );
  const submittedExplorationConfig = exploration?.config;
  // A block only tracks the dashboard date control when it hasn't opted out.
  const usesDashboardDateRange =
    blockUsesDashboardDateControl(block) &&
    Boolean(dashboardGlobalControls?.dateRange);
  const hasStaleDashboardDateResults = useMemo(
    () =>
      usesDashboardDateRange &&
      submittedConfig !== null &&
      submittedExplorationConfig !== undefined &&
      !isEqual(
        getExplorationDateControlFingerprint(submittedConfig),
        getExplorationDateControlFingerprint(submittedExplorationConfig),
      ),
    [usesDashboardDateRange, submittedConfig, submittedExplorationConfig],
  );
  const comparisonPayload = useMemo(() => {
    if (
      !compareEnabled ||
      !exploration ||
      !submittedConfig ||
      !submittedPreviousTimeFrame
    ) {
      return null;
    }
    return computeExplorationComparisonPayload(
      exploration,
      rawComparisonExploration,
      submittedConfig,
      submittedPreviousTimeFrame,
      (id) => getFactMetricById(id) ?? null,
      getComparisonAlignmentStrategy(comparisonMode),
    );
  }, [
    compareEnabled,
    exploration,
    rawComparisonExploration,
    submittedConfig,
    submittedPreviousTimeFrame,
    comparisonMode,
    getFactMetricById,
  ]);

  // Use the densified comparison exploration from the payload (matching the
  // Explorer) rather than the raw fetched one.
  const comparisonExploration = comparisonPayload?.exploration ?? null;

  if (isLoading || tileRun.loading) {
    return <LoadingSpinner />;
  }

  // Without the dashboard header, the tile offers its own Update button. With
  // the header, its Update covers every block, so the tile doesn't add one.
  const tileUpdates = headerless && !!runConfig;
  const updatePrompt = (message: string, status: "info" | "error" = "info") => (
    <Flex direction="column" align="center" gap="3" p="4">
      {tileRun.error ? (
        <Callout status="error">{tileRun.error}</Callout>
      ) : !runDatasource ? (
        <Callout status="warning">
          {message} The Data Source for this block can&apos;t be found.
        </Callout>
      ) : canRun ? (
        <Callout status={status}>{message}</Callout>
      ) : (
        <Callout status={status}>
          {message} Ask someone who can run queries on this Data Source to
          update it.
        </Callout>
      )}
      {canRun && (
        <Button variant="outline" onClick={tileRun.run}>
          Update
        </Button>
      )}
    </Flex>
  );

  if (tileUpdates && !explorationId) {
    return updatePrompt("No results yet.");
  }

  if (!exploration) {
    if (tileUpdates) return updatePrompt("No results yet.");
    return (
      <Flex direction="column" align="center" gap="3" p="4">
        <Callout status="info">
          Please click the <code>Update</code> button to generate the necessary
          data.
        </Callout>
      </Flex>
    );
  }

  if (exploration.status === "running") {
    return <LoadingSpinner />;
  }

  // Keep Update available so a failed run can be retried in place.
  if (tileUpdates && exploration.status === "error") {
    return updatePrompt(
      exploration.error || "This block's query failed.",
      "error",
    );
  }

  if (hasStaleDashboardDateResults) {
    if (tileUpdates) {
      return updatePrompt(
        "The dashboard dates changed since this block last ran.",
      );
    }
    return (
      <Flex direction="column" align="center" gap="3" p="4">
        <Callout status="info">
          Global controls changed. Click the <code>Update</code> button to
          refresh this block.
        </Callout>
      </Flex>
    );
  }

  const shouldShowTable = isTableChartType(block.config?.chartType);

  return (
    <Flex direction="column" gap="2" style={{ height: "100%", minHeight: 0 }}>
      {shouldShowTable ? (
        <ExplorerDataTable
          exploration={exploration}
          comparisonExploration={comparisonExploration}
          compareEnabled={compareEnabled}
          comparisonMode={compareEnabled ? comparisonMode : null}
          serverTableTrendsByRow={comparisonPayload?.tableTrendsByRow ?? null}
          error={exploration.error ?? error?.message ?? null}
          submittedExploreState={submittedConfig ?? exploration.config}
          loading={isLoading}
          hasChart={false}
          query={data?.query ?? null}
        />
      ) : (
        <ExplorerChart
          exploration={exploration}
          comparisonExploration={comparisonExploration}
          compareEnabled={compareEnabled}
          submittedPreviousTimeFrame={submittedPreviousTimeFrame}
          submittedComparisonMode={compareEnabled ? comparisonMode : null}
          serverBigNumberTrends={comparisonPayload?.bigNumberTrends ?? null}
          error={exploration.error || error?.message || null}
          loading={isLoading}
          submittedExploreState={submittedConfig ?? exploration.config}
        />
      )}
    </Flex>
  );
}
