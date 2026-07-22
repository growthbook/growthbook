import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Box, Flex } from "@radix-ui/themes";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { PiArrowsClockwise, PiChartLineUp, PiDotsSix } from "react-icons/pi";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import {
  hasSubmittablePayload,
  shouldChartSectionShow,
} from "@/enterprise/components/ProductAnalytics/util";
import Callout from "@/ui/Callout";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useOptionalSqlEditorContext } from "@/enterprise/components/ProductAnalytics/SqlEditorContext";
import ExplorerChart from "./ExplorerChart";
import ExplorerDataTable from "./ExplorerDataTable";
import SqlQuerySection from "./SqlQuerySection";
import Toolbar from "./Toolbar";

export default function ExplorerMainSection() {
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
    collapseFunnelStepsForAnalyze,
    compareEnabled,
    comparisonExploration,
    comparisonComputed,
    submittedPreviousTimeFrame,
  } = useExplorerContext();

  const showChartSection = shouldChartSectionShow({
    loading,
    error,
    submittedExploreState,
  });
  const isSql = draftExploreState.type === "sql";
  const sqlConfigIsReady =
    draftExploreState.type === "sql" &&
    draftExploreState.dataset.sql.trim().length > 0 &&
    draftExploreState.dataset.timestampColumn.length > 0 &&
    draftExploreState.dataset.columnTypes[
      draftExploreState.dataset.timestampColumn
    ] === "date" &&
    Object.keys(draftExploreState.dataset.columnTypes).length > 0;
  const sqlEditorContext = useOptionalSqlEditorContext();
  const viewMode = sqlEditorContext?.viewMode ?? "chart";
  const setViewMode = sqlEditorContext?.setViewMode;
  const setIsQueryActive = sqlEditorContext?.setIsQueryActive;
  const [chartReady, setChartReady] = useState(sqlConfigIsReady);
  const [sqlResultsTarget, setSqlResultsTarget] =
    useState<HTMLDivElement | null>(null);
  const [visualizationTarget, setVisualizationTarget] =
    useState<HTMLDivElement | null>(null);
  const sqlQueryPanelRef = useRef<ImperativePanelHandle>(null);

  useEffect(() => {
    if (isSql && !sqlConfigIsReady) {
      setChartReady(false);
      setViewMode?.("results");
    }
  }, [isSql, setViewMode, sqlConfigIsReady]);

  const handleChartReadyChange = useCallback(
    (ready: boolean) => {
      setChartReady(ready);
      if (!ready) {
        setViewMode?.("results");
      }
    },
    [setViewMode],
  );
  const handleSqlQueryOpenChange = useCallback((open: boolean) => {
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

  const suppressStaleFloatingCallout =
    funnelMainEmpty && needsFetch && !loading;

  return (
    <Flex
      direction="column"
      px="2"
      py="3"
      gap="4"
      id="main-section-wrapper"
      style={{ flex: "1", minHeight: 0 }}
    >
      {isSql ? (
        <PanelGroup
          direction="vertical"
          style={{ flex: 1, minHeight: 0, width: "100%" }}
        >
          <Panel
            ref={sqlQueryPanelRef}
            order={1}
            defaultSize={60}
            minSize={20}
            collapsible
            collapsedSize={8}
            style={{ display: "flex", flexDirection: "column", minHeight: 0 }}
          >
            <SqlQuerySection
              fullHeight
              onChartReadyChange={handleChartReadyChange}
              onQueryFocus={() => setIsQueryActive?.(true)}
              onOpenChange={handleSqlQueryOpenChange}
              onRunStart={() => setViewMode?.("results")}
              onRunSuccess={() => setViewMode?.("results")}
              onRunError={() => setViewMode?.("sql")}
              resultsTarget={sqlResultsTarget}
              activeResultsTab={viewMode}
              onResultsTabChange={(value) => {
                setIsQueryActive?.(false);
                if (
                  value === "chart" ||
                  value === "results" ||
                  value === "sql"
                ) {
                  setViewMode?.(value);
                }
              }}
              additionalResultsTab={{
                value: "chart",
                label: "Visualization",
                disabled: !chartReady,
                content: (
                  <Box
                    ref={setVisualizationTarget}
                    width="100%"
                    height="100%"
                    style={{ minHeight: 0, overflow: "hidden" }}
                  />
                ),
              }}
            />
          </Panel>
          <PanelResizeHandle
            style={{
              height: 20,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
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
          </PanelResizeHandle>
          <Panel order={2} defaultSize={40} minSize={25}>
            <Box
              ref={setSqlResultsTarget}
              width="100%"
              height="100%"
              style={{ minHeight: 0, overflow: "hidden" }}
            />
          </Panel>
        </PanelGroup>
      ) : (
        <Box
          ref={setVisualizationTarget}
          width="100%"
          style={{ flex: 1, minHeight: 0, overflow: "hidden" }}
        />
      )}
      {visualizationTarget && (!isSql || chartReady)
        ? createPortal(
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
                            submittedPreviousTimeFrame={
                              submittedPreviousTimeFrame
                            }
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
                        serverTableTrendsByRow={
                          comparisonComputed?.tableTrendsByRow ?? null
                        }
                      />
                    </Panel>
                  </PanelGroup>
                ) : (
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
                        <Text size="large" weight="medium">
                          Done configuring steps?
                        </Text>
                        <Button
                          size="lg"
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
                        <PiChartLineUp
                          size={48}
                          style={{ color: "var(--gray-a9)" }}
                        />
                        <Text size="large" weight="medium">
                          Configure your explorer to visualize data
                        </Text>
                      </>
                    )}
                  </Flex>
                )}

                {(needsFetch || loading) && !suppressStaleFloatingCallout && (
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
                          <LoadingSpinner
                            style={{ width: "12px", height: "12px" }}
                          />
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
            </Flex>,
            visualizationTarget,
          )
        : null}
    </Flex>
  );
}
