import { Box, Flex } from "@radix-ui/themes";
import { BsGraphUpArrow } from "react-icons/bs";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { PiArrowsClockwise, PiDotsSix, PiInfo } from "react-icons/pi";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import { shouldChartSectionShow } from "@/enterprise/components/ProductAnalytics/util";
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
    draftExploreState,
    handleSubmit,
    isSubmittable,
  } = useExplorerContext();

  const showChartSection = shouldChartSectionShow({
    loading,
    error,
    submittedExploreState,
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

      <Flex
        direction="column"
        gap="3"
        style={{ flex: "1", minHeight: 0, position: "relative" }}
        id="main-section-visuals"
      >
        {submittedExploreState?.dataset?.values?.length &&
        submittedExploreState?.dataset?.values?.length > 0 ? (
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
              <ExplorerDataTable hasChart={showChartSection} />
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
            <BsGraphUpArrow size={48} className="text-muted" />
            <Text size="large" weight="medium">
              Configure your explorer to visualize data
            </Text>
          </Flex>
        )}

        {(isStale || loading) && (
          <Box
            style={{
              position: "absolute",
              zIndex: 1000,
              top: 15,
              right: 15,
              width: "auto",
            }}
          >
            <Callout status="info" size="sm" icon={null} contentsAs="div">
              <Flex align="center" gap="2">
                {loading ? (
                  <Flex align="center" gap="2">
                    <LoadingSpinner style={{ width: "12px", height: "12px" }} />
                    <Text>Loading...</Text>
                  </Flex>
                ) : (
                  <>
                    <Text title="Some configuration changes require running a new SQL query against your data source">
                      <PiInfo /> Latest changes not applied
                    </Text>
                    <Button
                      size="sm"
                      variant="solid"
                      disabled={
                        !draftExploreState?.dataset?.values?.length ||
                        !isSubmittable
                      }
                      onClick={() => handleSubmit({ force: true })}
                    >
                      <Flex align="center" gap="2">
                        <PiArrowsClockwise />
                        Refresh
                      </Flex>
                    </Button>
                  </>
                )}
              </Flex>
            </Callout>
          </Box>
        )}
      </Flex>
    </Flex>
  );
}
