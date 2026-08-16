import { Box, Flex } from "@radix-ui/themes";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { PiArrowsClockwise, PiChartLineUp, PiDotsSix } from "react-icons/pi";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import {
  explorerMainPresentation,
  hasSubmittablePayload,
  type ExplorerDraftConfig,
  type ExplorerEmptyState,
} from "@/enterprise/components/ProductAnalytics/util";
import { journeyDiffersOnlyByPath } from "@/enterprise/components/ProductAnalytics/journey-policy";
import Callout from "@/ui/Callout";
import LoadingSpinner from "@/components/LoadingSpinner";
import ExplorerChart from "./ExplorerChart";
import ExplorerDataTable from "./ExplorerDataTable";
import Toolbar from "./Toolbar";

export default function ExplorerMainSection() {
  const {
    exploration,
    submittedExploreState,
    loading,
    error,
    isStale,
    query,
    draftExploreState,
    handleSubmit,
    isSubmittable,
    collapseFunnelStepsForAnalyze,
    compareEnabled,
    comparisonExploration,
    comparisonComputed,
    comparisonError,
    submittedPreviousTimeFrame,
    submittedComparisonMode,
  } = useExplorerContext();

  const { showChart, showTable, showStaleToast, emptyState } =
    explorerMainPresentation({
      draftType: draftExploreState.type,
      chartType: draftExploreState.chartType,
      submitted: submittedExploreState,
      hasChartData: (exploration?.result?.rows?.length ?? 0) > 0,
      loading,
      error,
      isStale,
      isSubmittable,
      pathOnlyChange:
        !!submittedExploreState &&
        journeyDiffersOnlyByPath(submittedExploreState, draftExploreState),
    });

  return (
    <Flex
      direction="column"
      px="2"
      py="3"
      gap="4"
      id="main-section-wrapper"
      style={{ flex: "1", minHeight: 0 }}
    >
      <Toolbar />
      {compareEnabled && comparisonError && !loading && (
        <Callout status="warning" size="sm">
          {`The comparison period could not be loaded, so only the current period is shown: ${comparisonError}`}
        </Callout>
      )}

      <Flex
        direction="column"
        gap="3"
        style={{ flex: "1", minHeight: 0, position: "relative" }}
        id="main-section-visuals"
      >
        {emptyState != null ? (
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
            <EmptyState
              emptyState={emptyState}
              loading={loading}
              draftExploreState={draftExploreState}
              isSubmittable={isSubmittable}
              collapseFunnelStepsForAnalyze={collapseFunnelStepsForAnalyze}
              handleSubmit={handleSubmit}
            />
          </Flex>
        ) : submittedExploreState ? (
          <PanelGroup direction="vertical" id="visualization-group">
            {showChart && (
              <>
                <Panel
                  id="chart"
                  order={1}
                  defaultSize={showTable ? 60 : 100}
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
                {showTable && (
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
                )}
              </>
            )}
            {showTable && (
              <Panel
                id="table"
                order={2}
                defaultSize={showChart ? 40 : 100}
                minSize={20}
              >
                <ExplorerDataTable
                  exploration={exploration}
                  error={error}
                  submittedExploreState={submittedExploreState}
                  loading={loading}
                  hasChart={showChart}
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
            )}
          </PanelGroup>
        ) : null}

        {showStaleToast && (
          <Box
            style={{
              position: "absolute",
              zIndex: 1000,
              top: 15,
              right: 15,
              width: "max-content",
              maxWidth: "calc(100% - 30px)",
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
            >
              {loading ? (
                <Text whiteSpace="nowrap">Loading...</Text>
              ) : (
                <Flex
                  align="center"
                  gap="3"
                  wrap="nowrap"
                  style={{ whiteSpace: "nowrap" }}
                >
                  <Text title="Some configuration changes require running a new SQL query against your data source">
                    Latest changes not applied
                  </Text>
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
                </Flex>
              )}
            </Callout>
          </Box>
        )}
      </Flex>
    </Flex>
  );
}

function EmptyState({
  emptyState,
  loading,
  draftExploreState,
  isSubmittable,
  collapseFunnelStepsForAnalyze,
  handleSubmit,
}: {
  emptyState: ExplorerEmptyState;
  loading: boolean;
  draftExploreState: ExplorerDraftConfig;
  isSubmittable: boolean;
  collapseFunnelStepsForAnalyze: () => void;
  handleSubmit: () => Promise<void>;
}) {
  switch (emptyState) {
    case "funnel-cta":
      return (
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
      );
    case "journey-loading":
      return (
        <>
          <LoadingSpinner />
          <Text size="lg" weight="medium">
            Loading journey…
          </Text>
        </>
      );
    case "journey-configure":
      return (
        <>
          <PiChartLineUp size={48} style={{ color: "var(--gray-a9)" }} />
          <Text size="lg" weight="medium">
            Configure this journey to visualize data
          </Text>
        </>
      );
    case "configure":
      return (
        <>
          <PiChartLineUp size={48} style={{ color: "var(--gray-a9)" }} />
          <Text size="lg" weight="medium">
            Configure your explorer to visualize data
          </Text>
        </>
      );
    default: {
      const _exhaustive: never = emptyState;
      return _exhaustive;
    }
  }
}
