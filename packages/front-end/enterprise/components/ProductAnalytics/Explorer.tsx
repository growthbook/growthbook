import React from "react";
import { Flex, Box } from "@radix-ui/themes";
import ExplorerSideBar from "./SideBar/ExplorerSideBar";
import { ExplorerProvider } from "./ExplorerContext";
import ExplorerMainSection from "./MainSection/ExplorerMainSection";

function MetricExplorerContent() {
  return (
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
        <ExplorerSideBar />
      </Box>
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
