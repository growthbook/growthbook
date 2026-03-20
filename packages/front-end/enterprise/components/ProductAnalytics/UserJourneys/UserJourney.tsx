import { Flex, Box } from "@radix-ui/themes";
import { PiDotsSix } from "react-icons/pi";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { UserJourneyConfig } from "shared/validators";
import ShadowedScrollArea from "@/components/ShadowedScrollArea/ShadowedScrollArea";
import { useDefinitions } from "@/services/DefinitionsContext";
import SideBar from "./SideBar";
import { UserJourneyProvider } from "./UserJourneyContext";
import UserJourneyMainSection from "./UserJourneyMainSection";

export function UserJourneyContent() {
  return (
    <Flex direction="column" gap="3" height="calc(100vh - 72px)">
      <PanelGroup direction="horizontal">
        {/* Main Section */}
        <Panel
          id="main-section"
          order={1}
          defaultSize={75}
          minSize={65}
          style={{ display: "flex", flexDirection: "column" }}
        >
          <UserJourneyMainSection />
        </Panel>

        {/* Resize Handle */}
        <PanelResizeHandle
          style={{
            width: "10px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Box
            flexGrow="1"
            mb="3"
            mt="9"
            style={{ backgroundColor: "var(--gray-a3)", width: "1px" }}
          ></Box>
          <PiDotsSix size={16} style={{ transform: "rotate(90deg)" }} />
          <Box
            flexGrow="1"
            my="3"
            style={{ backgroundColor: "var(--gray-a3)", width: "1px" }}
          ></Box>
        </PanelResizeHandle>

        {/* Sidebar */}
        <Panel id="sidebar" order={2} defaultSize={25} minSize={20}>
          <ShadowedScrollArea height="calc(100vh - 160px)">
            <SideBar renderingInDashboardSidebar={false} />
          </ShadowedScrollArea>
        </Panel>
      </PanelGroup>
    </Flex>
  );
}

export default function UserJourney() {
  const { datasources } = useDefinitions();

  const defaultDraftState: UserJourneyConfig = {
    datasource: datasources[0]?.id || "",
    factTableId: "",
    startingEventMode: "eventColumn",
    startingEventEventColumn: {
      column: "",
      value: "",
    },
    startingEventFilters: [],
    userIdType: "",
    globalFilters: [],
    conversionWindow: {
      value: 1,
      unit: "minute",
    },
    measurementType: "total",
    dateRange: {
      predefined: "last30Days",
      lookbackValue: 30,
      startDate: null,
      endDate: null,
    },
    forwardPath: [],
    numOfEventsPerStep: 5,
  };

  return (
    <UserJourneyProvider initialConfig={defaultDraftState}>
      <UserJourneyContent />
    </UserJourneyProvider>
  );
}
