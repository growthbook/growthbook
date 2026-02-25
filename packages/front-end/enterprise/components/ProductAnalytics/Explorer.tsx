import React from "react";
import { Flex, Box } from "@radix-ui/themes";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { PiDotsSix } from "react-icons/pi";
import ShadowedScrollArea from "@/components/ShadowedScrollArea/ShadowedScrollArea";
import ExplorerSideBar from "./SideBar/ExplorerSideBar";
import { ExplorerProvider, useExplorerContext } from "./ExplorerContext";
import ExplorerMainSection from "./MainSection/ExplorerMainSection";
import EmptyState from "./EmptyState";

function MetricExplorerContent() {
  const { isEmpty } = useExplorerContext();

  if (isEmpty) {
    return <EmptyState />;
  }

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
          <ExplorerMainSection />
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
            <ExplorerSideBar />
          </ShadowedScrollArea>
        </Panel>
      </PanelGroup>
    </Flex>
  );
}

export default function MetricExplorer() {
  return (
    <ExplorerProvider>
      <MetricExplorerContent />
    </ExplorerProvider>
  );
}
