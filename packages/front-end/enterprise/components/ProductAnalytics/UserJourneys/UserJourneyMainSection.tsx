import { Box, Flex } from "@radix-ui/themes";
import {
  PiArrowsClockwise,
  PiDotsSix,
  PiInfo,
  PiTreeStructure,
} from "react-icons/pi";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import LoadingSpinner from "@/components/LoadingSpinner";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import { useUserJourneyContext } from "./UserJourneyContext";
import Toolbar from "./Toolbar";
import UserJourneyDataTable from "./UserJourneyDataTable";
import UserJourneySankeyChart from "./UserJourneySankeyChart";

export default function UserJourneyMainSection() {
  const {
    userJourney,
    handleExtendPath,
    loading,
    error,
    query,
    isStale,
    isSubmittable,
    handleSubmit,
  } = useUserJourneyContext();
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
        {userJourney?.result?.rows?.length &&
        userJourney?.result?.rows?.length > 0 ? (
          <PanelGroup direction="vertical" id="visualization-group">
            <Panel
              id="chart"
              order={1}
              defaultSize={90}
              minSize={30}
              style={{ display: "flex", flexDirection: "column", minHeight: 0 }}
            >
              <UserJourneySankeyChart
                rows={userJourney.result.rows}
                onExtendPath={handleExtendPath}
                extending={loading}
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
            <Panel
              id="table"
              order={2}
              defaultSize={10}
              minSize={10}
              style={{ display: "flex", flexDirection: "column", minHeight: 0 }}
            >
              <UserJourneyDataTable
                rows={userJourney.result.rows}
                error={error}
                query={query}
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
            <PiTreeStructure size={48} className="text-muted" />
            <Text size="large" weight="medium">
              Select an event to see what your users do before and after it.
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
                    <Text title="Some configuration changes require running a new query against your data source">
                      <PiInfo /> Latest changes not applied
                    </Text>
                    <Button
                      size="sm"
                      variant="solid"
                      disabled={!isSubmittable}
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
