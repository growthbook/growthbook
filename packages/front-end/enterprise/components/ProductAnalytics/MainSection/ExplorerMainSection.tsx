import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Box, Flex } from "@radix-ui/themes";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { PiArrowsClockwise, PiChartLineUp, PiDotsSix } from "react-icons/pi";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import {
  hasSubmittablePayload,
  isTimelessSqlExploration,
  shouldChartSectionShow,
} from "@/enterprise/components/ProductAnalytics/util";
import Callout from "@/ui/Callout";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useOptionalSqlEditorContext } from "@/enterprise/components/ProductAnalytics/SqlEditorContext";
import ExplorerChart from "./ExplorerChart";
import ExplorerDataTable from "./ExplorerDataTable";
import SqlQuerySection from "./SqlQuerySection";
import Toolbar from "./Toolbar";
import DataSourceDropdown from "./Toolbar/DataSourceDropdown";

const SQL_QUERY_PANEL_MAX_PERCENT = 60;
const SQL_QUERY_PANEL_MIN_PERCENT = 12;
const SQL_QUERY_HEADER_PX = 52;
const SQL_EDITOR_LINE_HEIGHT_PX = 18;
const SQL_EDITOR_PADDING_PX = 20;

function getSqlQueryPanelPercent(sql: string, groupHeightPx: number): number {
  if (groupHeightPx <= 0) return SQL_QUERY_PANEL_MAX_PERCENT;
  const lineCount = Math.max(sql.split("\n").length, 1);
  const contentHeightPx =
    SQL_QUERY_HEADER_PX +
    lineCount * SQL_EDITOR_LINE_HEIGHT_PX +
    SQL_EDITOR_PADDING_PX;
  const percent = (contentHeightPx / groupHeightPx) * 100;
  return Math.min(
    SQL_QUERY_PANEL_MAX_PERCENT,
    Math.max(SQL_QUERY_PANEL_MIN_PERCENT, percent),
  );
}
function ExplorerVisualizationPane({ emptyState }: { emptyState: ReactNode }) {
  const {
    exploration,
    submittedExploreState,
    loading,
    error,
    isStale,
    needsFetch,
    query,
    draftExploreState,
    handleSubmit,
    isSubmittable,
    compareEnabled,
    comparisonExploration,
    comparisonComputed,
    comparisonError,
    submittedPreviousTimeFrame,
    submittedComparisonMode,
  } = useExplorerContext();

  const showChartSection = shouldChartSectionShow({
    loading,
    error,
    submittedExploreState,
  });

  const suppressStaleFloatingCallout =
    !hasSubmittablePayload(submittedExploreState) ||
    (!loading && needsFetch && !isSubmittable);

  return (
    <Flex
      direction="column"
      gap="3"
      p="3"
      width="100%"
      height="100%"
      style={{
        flex: "1",
        minHeight: 0,
        position: "relative",
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-4)",
        backgroundColor: "var(--color-panel-translucent)",
        overflow: "hidden",
      }}
      id="main-section-visuals"
    >
      <Toolbar />
      {compareEnabled && comparisonError && !loading && (
        <Callout status="warning" size="sm">
          {`The comparison period could not be loaded, so only the current period is shown: ${comparisonError}`}
        </Callout>
      )}
      <Flex
        direction="column"
        style={{ flex: 1, minHeight: 0, position: "relative" }}
      >
        {hasSubmittablePayload(submittedExploreState) ? (
          <PanelGroup direction="vertical" id="visualization-group">
            {showChartSection && (
              <>
                <Panel
                  id="chart"
                  order={1}
                  defaultSize={60}
                  minSize={20}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 0,
                  }}
                >
                  <ExplorerChart
                    exploration={exploration}
                    error={error}
                    submittedExploreState={submittedExploreState}
                    loading={loading}
                    compareEnabled={compareEnabled}
                    comparisonExploration={comparisonExploration}
                    submittedPreviousTimeFrame={submittedPreviousTimeFrame}
                    submittedComparisonMode={submittedComparisonMode}
                    serverBigNumberTrends={
                      comparisonComputed?.bigNumberTrends ?? null
                    }
                  />
                </Panel>
                <PanelResizeHandle
                  style={{
                    height: "20px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Box
                    flexGrow="1"
                    mx="3"
                    style={{
                      backgroundColor: "var(--gray-a3)",
                      height: "1px",
                    }}
                  ></Box>
                  <PiDotsSix size={16} />
                  <Box
                    flexGrow="1"
                    mx="3"
                    style={{
                      backgroundColor: "var(--gray-a3)",
                      height: "1px",
                    }}
                  ></Box>
                </PanelResizeHandle>
              </>
            )}
            <Panel
              id="table"
              order={2}
              defaultSize={showChartSection ? 40 : 100}
              minSize={20}
            >
              <ExplorerDataTable
                exploration={exploration}
                error={error}
                submittedExploreState={submittedExploreState}
                loading={loading}
                hasChart={showChartSection}
                isStale={isStale}
                query={query}
                compareEnabled={compareEnabled}
                comparisonExploration={comparisonExploration}
                comparisonMode={submittedComparisonMode}
                serverTableTrendsByRow={
                  comparisonComputed?.tableTrendsByRow ?? null
                }
              />
            </Panel>
          </PanelGroup>
        ) : (
          emptyState
        )}

        {(isStale || loading) && !suppressStaleFloatingCallout && (
          <Box
            style={{
              position: "absolute",
              zIndex: 1000,
              top: 15,
              right: 15,
              width: "auto",
              backgroundColor: "var(--color-panel-solid)",
              borderRadius: "var(--radius-3)",
            }}
          >
            <Callout
              status="info"
              size="sm"
              icon={
                loading ? (
                  <LoadingSpinner style={{ width: "12px", height: "12px" }} />
                ) : undefined
              }
              action={
                loading ? undefined : (
                  <Button
                    color="inherit"
                    size="sm"
                    variant="solid"
                    disabled={
                      !hasSubmittablePayload(draftExploreState) ||
                      !isSubmittable
                    }
                    onClick={() => handleSubmit({ force: true })}
                  >
                    <Flex align="center" gap="2">
                      <PiArrowsClockwise />
                      Refresh
                    </Flex>
                  </Button>
                )
              }
            >
              {loading ? (
                "Loading..."
              ) : (
                <Text title="Some configuration changes require running a new SQL query against your data source">
                  Latest changes not applied
                </Text>
              )}
            </Callout>
          </Box>
        )}
      </Flex>
    </Flex>
  );
}

export default function ExplorerMainSection({
  showDataSourceSelector = true,
}: {
  showDataSourceSelector?: boolean;
}) {
  const {
    submittedExploreState,
    loading,
    draftExploreState,
    handleSubmit,
    isSubmittable,
    collapseFunnelStepsForAnalyze,
  } = useExplorerContext();

  const isSql = draftExploreState.type === "sql";
  const isRawTable = isSql && draftExploreState.chartType === "rawTable";
  const sqlConfigIsReady =
    draftExploreState.type === "sql" &&
    draftExploreState.dataset.sql.trim().length > 0 &&
    Object.keys(draftExploreState.dataset.columnTypes).length > 0;
  const sqlEditorContext = useOptionalSqlEditorContext();
  const viewMode = sqlEditorContext?.viewMode ?? "explore";
  const setViewMode = sqlEditorContext?.setViewMode;
  const exploreReady = sqlEditorContext?.exploreReady ?? sqlConfigIsReady;
  const [sqlResultsTarget, setSqlResultsTarget] =
    useState<HTMLDivElement | null>(null);
  const [sqlQueryOpen, setSqlQueryOpen] = useState(true);
  const [hasSqlPreview, setHasSqlPreview] = useState(false);
  // Mount Explore once ready so returning to Dataset doesn't remount viz state.
  const [hasMountedExplore, setHasMountedExplore] = useState(exploreReady);
  const sqlQueryPanelRef = useRef<ImperativePanelHandle>(null);
  const sqlPanelGroupRef = useRef<HTMLDivElement | null>(null);
  const localSql = sqlEditorContext?.localSql ?? "";
  const localSqlRef = useRef(localSql);
  localSqlRef.current = localSql;

  useEffect(() => {
    if (exploreReady) setHasMountedExplore(true);
  }, [exploreReady]);

  useEffect(() => {
    if (isSql && !exploreReady) {
      setViewMode?.("dataset");
    }
  }, [exploreReady, isSql, setViewMode]);

  // When results appear, shrink the query panel to fit the SQL when possible.
  useEffect(() => {
    if (!hasSqlPreview || viewMode !== "dataset") return;

    // Wait until the results panel has mounted and laid out.
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const groupHeight =
          sqlPanelGroupRef.current?.getBoundingClientRect().height ?? 0;
        const percent = getSqlQueryPanelPercent(
          localSqlRef.current,
          groupHeight,
        );
        sqlQueryPanelRef.current?.resize(percent);
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [hasSqlPreview, viewMode]);

  const handleSqlQueryOpenChange = useCallback((open: boolean) => {
    setSqlQueryOpen(open);
    if (open) {
      sqlQueryPanelRef.current?.expand();
    } else {
      sqlQueryPanelRef.current?.collapse();
    }
  }, []);

  const funnelMainEmpty =
    draftExploreState.type === "funnel" &&
    draftExploreState.dataset?.type === "funnel" &&
    !hasSubmittablePayload(submittedExploreState);

  const exploreEmptyState = (
    <Flex
      align="center"
      justify="center"
      direction="column"
      gap="3"
      style={{
        flex: 1,
        minHeight: "400px",
        color: "var(--color-text-mid)",
        border: "2px dashed var(--gray-a3)",
        borderRadius: "var(--radius-4)",
      }}
    >
      {funnelMainEmpty ? (
        <>
          <Text size="lg" weight="medium">
            Done configuring steps?
          </Text>
          <Button
            size="xl"
            variant="solid"
            disabled={
              loading ||
              !hasSubmittablePayload(draftExploreState) ||
              !isSubmittable
            }
            onClick={async () => {
              collapseFunnelStepsForAnalyze();
              await handleSubmit();
            }}
          >
            <Flex align="center" gap="2">
              <PiArrowsClockwise />
              Analyze Funnel
            </Flex>
          </Button>
        </>
      ) : (
        <>
          {isRawTable ? (
            <Flex direction="column" align="center" gap="3">
              <Button
                size="lg"
                variant="solid"
                loading={loading}
                disabled={
                  loading ||
                  !hasSubmittablePayload(draftExploreState) ||
                  !isSubmittable
                }
                onClick={() => handleSubmit({ force: true })}
              >
                Load Table
              </Button>
              <Text size="sm" color="text-low">
                {isTimelessSqlExploration(draftExploreState)
                  ? "Configure columns in the sidebar."
                  : "Configure columns in the sidebar, or change the date range above."}
              </Text>
            </Flex>
          ) : (
            <>
              <PiChartLineUp size={48} style={{ color: "var(--gray-a9)" }} />
              <Text size="lg" weight="medium">
                {isSql
                  ? "Add a value in the sidebar, then click Update to explore"
                  : "Configure your explorer to visualize data"}
              </Text>
            </>
          )}
        </>
      )}
    </Flex>
  );

  return (
    <Flex
      direction="column"
      px="2"
      // Match ExplorerSideBar's p="2" in SQL mode so the Query and Schema
      // Browser panels share a top edge.
      py={isSql ? "2" : "3"}
      gap="4"
      id="main-section-wrapper"
      style={{ flex: "1", minHeight: 0 }}
    >
      {showDataSourceSelector ? (
        <Flex align="center" flexShrink="0" height="32px">
          <DataSourceDropdown />
        </Flex>
      ) : null}
      {isSql ? (
        <>
          {/* Keep Dataset mounted while on Explore so editor/preview state survives
              tab switches. Explore mounts once ready and then stays mounted. */}
          <Box
            ref={sqlPanelGroupRef}
            style={{
              flex: 1,
              minHeight: 0,
              display: viewMode === "dataset" ? "flex" : "none",
              flexDirection: "column",
            }}
          >
            <PanelGroup
              direction="vertical"
              style={{ flex: 1, minHeight: 0, width: "100%" }}
            >
              <Panel
                ref={sqlQueryPanelRef}
                order={1}
                defaultSize={hasSqlPreview ? SQL_QUERY_PANEL_MAX_PERCENT : 100}
                minSize={hasSqlPreview ? SQL_QUERY_PANEL_MIN_PERCENT : 20}
                collapsible={hasSqlPreview}
                collapsedSize={8}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 0,
                }}
              >
                <SqlQuerySection
                  fullHeight
                  onOpenChange={handleSqlQueryOpenChange}
                  onPreviewPresenceChange={setHasSqlPreview}
                  resultsTarget={hasSqlPreview ? sqlResultsTarget : null}
                />
              </Panel>
              {hasSqlPreview ? (
                <>
                  <PanelResizeHandle
                    style={{
                      height: sqlQueryOpen ? 20 : 10,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {sqlQueryOpen ? (
                      <>
                        <Box
                          flexGrow="1"
                          mx="3"
                          style={{
                            height: 1,
                            backgroundColor: "var(--gray-a4)",
                          }}
                        />
                        <PiDotsSix size={16} />
                        <Box
                          flexGrow="1"
                          mx="3"
                          style={{
                            height: 1,
                            backgroundColor: "var(--gray-a4)",
                          }}
                        />
                      </>
                    ) : null}
                  </PanelResizeHandle>
                  <Panel order={2} defaultSize={40} minSize={25}>
                    <Box
                      ref={setSqlResultsTarget}
                      width="100%"
                      height="100%"
                      style={{ minHeight: 0, overflow: "hidden" }}
                    />
                  </Panel>
                </>
              ) : null}
            </PanelGroup>
          </Box>
          {hasMountedExplore ? (
            <Box
              style={{
                flex: 1,
                minHeight: 0,
                display: viewMode === "explore" ? "flex" : "none",
                flexDirection: "column",
              }}
            >
              <ExplorerVisualizationPane emptyState={exploreEmptyState} />
            </Box>
          ) : null}
        </>
      ) : (
        <ExplorerVisualizationPane emptyState={exploreEmptyState} />
      )}
    </Flex>
  );
}
