import React from "react";
import { Flex, Box } from "@radix-ui/themes";
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
    <Flex direction="column" gap="3">
      <Flex width="100%">
        {/* Main Section */}
        <Box
          style={{
            flex: "1 1 auto",
            minWidth: 0,
          }}
        >
          <ExplorerMainSection />
        </Box>

        {/* Sidebar */}
        <Box
          style={{
            flex: "0 0 320px",
            minWidth: "280px",
            maxWidth: "380px",
            padding: "var(--space-3)",
          }}
        >
          <ShadowedScrollArea height="calc(100vh - 160px)">
            <ExplorerSideBar />
          </ShadowedScrollArea>
        </Box>
      </Flex>
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
