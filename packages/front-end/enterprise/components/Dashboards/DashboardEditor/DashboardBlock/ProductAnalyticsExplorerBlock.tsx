import { Flex } from "@radix-ui/themes";
import { ReactNode, useMemo } from "react";
import { createPortal } from "react-dom";
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
  resolveComparisonPreviousTimeFrame,
} from "shared/enterprise";
import { isEqual } from "lodash";
import {
  ComparisonMode,
  ExplorationConfig,
  ExplorationDateRange,
} from "shared/validators";
import { isManagedWarehousePendingQueryError } from "shared/util";
import useApi from "@/hooks/useApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { isTableChartType } from "@/enterprise/components/ProductAnalytics/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import ExplorerChart from "@/enterprise/components/ProductAnalytics/MainSection/ExplorerChart";
import ExplorerDataTable from "@/enterprise/components/ProductAnalytics/MainSection/ExplorerDataTable";
import ComparisonErrorCallout from "@/enterprise/components/ProductAnalytics/MainSection/ComparisonErrorCallout";
import ManagedWarehouseNoEventsCallout from "@/components/ManagedWarehouse/ManagedWarehouseNoEventsCallout";
import LoadingSpinner from "@/components/LoadingSpinner";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import { BLOCK_TYPE_INFO } from "@/enterprise/components/Dashboards/DashboardEditor/dashboardBlockTypes";
import {
  Loaded,
  TileResult,
  pollDelayForExploration,
  useTileResult,
} from "./useTileResult";
import { BlockProps } from ".";

type ExplorationBlockInterface =
  | MetricExplorationBlockInterface
  | FactTableExplorationBlockInterface
  | DataSourceExplorationBlockInterface
  | SqlExplorationBlockInterface
  | FunnelExplorationBlockInterface;

type TileSettings = {
  block: DashboardBlockInterfaceOrData<ExplorationBlockInterface>;
  // The block's config, with the dashboard's dates when it follows them
  config: ExplorationConfig | null;
  compareEnabled: boolean;
  comparisonMode: ComparisonMode;
  usesDashboardDateRange: boolean;
};

export default function ProductAnalyticsExplorerBlock({
  block,
  dashboardGlobalControls,
  dashboardComparison,
  selfUpdate = false,
  headerActionSlot = null,
}: BlockProps<ExplorationBlockInterface>) {
  const dateControlledBlock = blockUsesDashboardDateControl(block)
    ? block
    : null;
  const config = useMemo(
    () =>
      block.config && dashboardGlobalControls && dateControlledBlock
        ? getEffectiveExplorationConfig(dateControlledBlock, {
            globalControls: dashboardGlobalControls,
          })
        : (block.config ?? null),
    [block.config, dashboardGlobalControls, dateControlledBlock],
  );
  // Pass the dashboard, or a dashboard-wide comparison renders as primary-only.
  // The previous-period exploration is a separate entity produced on refresh.
  const comparison = resolveBlockComparison(block, {
    comparison: dashboardComparison,
  });
  const settings: TileSettings = {
    block,
    config,
    compareEnabled: !!comparison?.enabled,
    comparisonMode: comparison
      ? resolveComparisonMode(comparison)
      : "previousPeriod",
    // A block only tracks the dashboard date control when it hasn't opted out.
    usesDashboardDateRange:
      !!dateControlledBlock && Boolean(dashboardGlobalControls?.dateRange),
  };

  if (selfUpdate && config) {
    return (
      <SelfUpdatingTile
        settings={settings}
        config={config}
        previousTimeFrame={
          comparison?.enabled
            ? resolveComparisonPreviousTimeFrame(config.dateRange, comparison)
            : null
        }
        headerActionSlot={headerActionSlot}
      />
    );
  }
  return <StoredTile settings={settings} />;
}

function TilePrompt({
  status = "info",
  children,
}: {
  status?: "info" | "warning" | "error";
  children: ReactNode;
}) {
  return (
    <Flex direction="column" align="center" p="4">
      <Callout status={status} contentAlign="center">
        {children}
      </Callout>
    </Flex>
  );
}

// Shows the result stored on the block, which the dashboard header's Update
// writes.
function StoredTile({ settings }: { settings: TileSettings }) {
  const { block, compareEnabled } = settings;
  const { data, error, isLoading } = useApi<{ status: number } & Loaded>(
    `/product-analytics/exploration/${block.explorerAnalysisId}`,
    {
      shouldRun: () => !!block.explorerAnalysisId,
      // A tile's exploration can be returned still "running" (a refresh query
      // that exceeded the ~5s sync budget keeps executing server-side). Poll on
      // a backoff until it reaches a terminal state; 0 stops the interval.
      refreshInterval: (latest) => pollDelayForExploration(latest?.exploration),
    },
  );
  const { data: comparisonData } = useApi<{ status: number } & Loaded>(
    `/product-analytics/exploration/${block.comparisonExplorerAnalysisId}`,
    {
      shouldRun: () => compareEnabled && !!block.comparisonExplorerAnalysisId,
      refreshInterval: (latest) => pollDelayForExploration(latest?.exploration),
    },
  );

  if (isLoading) {
    return <LoadingSpinner />;
  }
  return (
    <TileBody
      settings={settings}
      result={{
        exploration: data?.exploration ?? null,
        query: data?.query ?? null,
        comparison: comparisonData?.exploration ?? null,
        comparisonError: null,
      }}
      loadError={error?.message ?? null}
      emptyState={
        <TilePrompt>
          Click <strong>Update</strong> to generate the necessary data.
        </TilePrompt>
      }
      staleState={
        <TilePrompt>
          Global controls changed. Click <strong>Update</strong> to refresh this
          block.
        </TilePrompt>
      }
    />
  );
}

// Starts from the stored result, or from the cache for a block that was never
// saved, and offers its own Update in the block's title row.
function SelfUpdatingTile({
  settings,
  config,
  previousTimeFrame,
  headerActionSlot,
}: {
  settings: TileSettings;
  config: ExplorationConfig;
  previousTimeFrame: ExplorationDateRange | null;
  headerActionSlot: HTMLElement | null;
}) {
  const { block, comparisonMode } = settings;
  const { getDatasourceById } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const datasource = getDatasourceById(config.datasource);
  const canRun =
    !!datasource &&
    permissionsUtil.canRunProductAnalyticsExplorationQueries(
      datasource,
      config.type,
    );
  const { state, run } = useTileResult({
    config,
    previousTimeFrame,
    comparisonMode,
    stored: block.explorerAnalysisId || null,
    storedComparison: block.comparisonExplorerAnalysisId || null,
  });

  const needsRun = (message: string) => (
    <TilePrompt status={datasource ? "info" : "warning"}>
      {message}{" "}
      {!datasource ? (
        "The Data Source for this block can't be found."
      ) : canRun ? (
        <>
          Click <strong>Update</strong> to run this block.
        </>
      ) : (
        "Ask someone who can run queries on this Data Source to update it."
      )}
    </TilePrompt>
  );

  return (
    <>
      {canRun &&
        headerActionSlot &&
        createPortal(
          <Flex mr="2">
            <Button
              variant="outline"
              size="sm"
              onClick={run}
              // Each tile has its own Update; name the block for screen
              // readers, with the visible label first so voice control matches
              aria-label={`Update: ${block.title || BLOCK_TYPE_INFO[block.type].name}`}
            >
              Update
            </Button>
          </Flex>,
          headerActionSlot,
        )}
      {state.status === "loading" ? (
        <LoadingSpinner />
      ) : state.status === "error" ? (
        isManagedWarehousePendingQueryError(state.error) ? (
          <Flex justify="center" p="4">
            <ManagedWarehouseNoEventsCallout size="sm" />
          </Flex>
        ) : (
          <TilePrompt status="error">{state.error}</TilePrompt>
        )
      ) : (
        <TileBody
          settings={settings}
          result={state.status === "ready" ? state.result : null}
          loadError={null}
          emptyState={needsRun("No results yet.")}
          staleState={needsRun(
            "The dashboard dates changed since this block last ran.",
          )}
        />
      )}
    </>
  );
}

// Draws one exploration, with its comparison when the block compares periods.
function TileBody({
  settings,
  result,
  loadError,
  emptyState,
  staleState,
}: {
  settings: TileSettings;
  result: TileResult | null;
  loadError: string | null;
  emptyState: ReactNode;
  staleState: ReactNode;
}) {
  const { block, config, compareEnabled, comparisonMode } = settings;
  const { getFactMetricById } = useDefinitions();
  const exploration = result?.exploration ?? null;
  const rawComparison = result?.comparison ?? null;
  const submittedConfig = config ?? exploration?.config ?? null;
  // The resolved previous window lives on the comparison exploration's config.
  const submittedPreviousTimeFrame = rawComparison?.config?.dateRange ?? null;
  const submittedExplorationConfig = exploration?.config;
  const hasStaleDashboardDateResults = useMemo(
    () =>
      settings.usesDashboardDateRange &&
      submittedConfig !== null &&
      submittedExplorationConfig !== undefined &&
      !isEqual(
        getExplorationDateControlFingerprint(submittedConfig),
        getExplorationDateControlFingerprint(submittedExplorationConfig),
      ),
    [
      settings.usesDashboardDateRange,
      submittedConfig,
      submittedExplorationConfig,
    ],
  );
  // Dashboard blocks fetch the primary + previous explorations directly,
  // bypassing the Explorer, which builds its comparison payload via
  // computeExplorationComparisonPayload (densified rows + trends). Recreate
  // that payload here with the same shared helper so the dashboard matches the
  // Explorer: empty previous periods densify to zeros instead of triggering the
  // "no data, nothing to compare" message, and big-number / table trends are
  // computed identically.
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
      rawComparison,
      submittedConfig,
      submittedPreviousTimeFrame,
      (id) => getFactMetricById(id) ?? null,
      getComparisonAlignmentStrategy(comparisonMode),
    );
  }, [
    compareEnabled,
    exploration,
    rawComparison,
    submittedConfig,
    submittedPreviousTimeFrame,
    comparisonMode,
    getFactMetricById,
  ]);
  // Use the densified comparison exploration from the payload (matching the
  // Explorer) rather than the raw fetched one.
  const comparisonExploration = comparisonPayload?.exploration ?? null;

  if (!exploration) return <>{emptyState}</>;
  if (exploration.status === "running") return <LoadingSpinner />;
  if (hasStaleDashboardDateResults) return <>{staleState}</>;

  const error = exploration.error || loadError || null;
  return (
    <Flex direction="column" gap="2" style={{ height: "100%", minHeight: 0 }}>
      {compareEnabled && result?.comparisonError && (
        <ComparisonErrorCallout error={result.comparisonError} />
      )}
      {isTableChartType(block.config?.chartType) ? (
        <ExplorerDataTable
          exploration={exploration}
          comparisonExploration={comparisonExploration}
          compareEnabled={compareEnabled}
          comparisonMode={compareEnabled ? comparisonMode : null}
          serverTableTrendsByRow={comparisonPayload?.tableTrendsByRow ?? null}
          error={error}
          submittedExploreState={submittedConfig ?? exploration.config}
          loading={false}
          hasChart={false}
          query={result?.query ?? null}
        />
      ) : (
        <ExplorerChart
          exploration={exploration}
          comparisonExploration={comparisonExploration}
          compareEnabled={compareEnabled}
          submittedPreviousTimeFrame={submittedPreviousTimeFrame}
          submittedComparisonMode={compareEnabled ? comparisonMode : null}
          serverBigNumberTrends={comparisonPayload?.bigNumberTrends ?? null}
          error={error}
          loading={false}
          submittedExploreState={submittedConfig ?? exploration.config}
        />
      )}
    </Flex>
  );
}
