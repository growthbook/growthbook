import { Box, Flex } from "@radix-ui/themes";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { PiArrowsClockwise, PiChartLineUp, PiDotsSix } from "react-icons/pi";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import {
  hasSubmittablePayload,
  isQueryTimeoutError,
  shouldChartSectionShow,
} from "@/enterprise/components/ProductAnalytics/util";
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

  const showChartSection = shouldChartSectionShow({
    loading,
    error,
    submittedExploreState,
  });

  const funnelMainEmpty =
    draftExploreState.type === "funnel" &&
    draftExploreState.dataset?.type === "funnel" &&
    !hasSubmittablePayload(submittedExploreState);

  const suppressStaleFloatingCallout = funnelMainEmpty && isStale && !loading;
  const isTimeoutError = !loading && isQueryTimeoutError(error);
  const retryDisabled =
    !hasSubmittablePayload(draftExploreState) || !isSubmittable;

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
                    style={{ backgroundColor: "var(--gray-a3)", height: "1px" }}
                  ></Box>
                  <PiDotsSix size={16} />
                  <Box
                    flexGrow="1"
                    mx="3"
                    style={{ backgroundColor: "var(--gray-a3)", height: "1px" }}
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
                <PiChartLineUp size={48} style={{ color: "var(--gray-a9)" }} />

                <Text size="lg" weight="medium">
                  Configure your explorer to visualize data
                </Text>
              </>
            )}
          </Flex>
        )}
        {(isStale || loading || isTimeoutError) &&
          !suppressStaleFloatingCallout && (
            <Box
              style={{
                position: "absolute",
                zIndex: 1000,
                top: isTimeoutError ? 63 : 12,
                right: 15,
                width: "auto",
                backgroundColor: "var(--color-panel-solid)",
                borderRadius: "var(--radius-3)",
              }}
            >
              <Callout
                status={isTimeoutError ? "error" : "info"}
                size="sm"
                align="center"
                wrap="nowrap"
                icon={
                  loading ? (
                    <LoadingSpinner style={{ width: "12px", height: "12px" }} />
                  ) : undefined
                }
                action={
                  !loading ? (
                    <Button
                      color="inherit"
                      size="sm"
                      variant="solid"
                      disabled={retryDisabled}
                      onClick={() => handleSubmit({ force: true })}
                      icon={<PiArrowsClockwise />}
                    >
                      {isTimeoutError ? "Retry" : "Refresh"}
                    </Button>
                  ) : undefined
                }
              >
                <Text
                  title={
                    !loading && !isTimeoutError
                      ? "Some configuration changes require running a new SQL query against your data source"
                      : undefined
                  }
                >
                  {loading
                    ? "Loading..."
                    : isTimeoutError
                      ? "Query timed out"
                      : "Latest changes not applied"}
                </Text>
              </Callout>
            </Box>
          )}
      </Flex>
    </Flex>
  );
}
