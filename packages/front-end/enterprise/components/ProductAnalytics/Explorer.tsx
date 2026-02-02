import React from "react";
import { Flex, Box } from "@radix-ui/themes";
import { PiChartBar, PiTable, PiCode } from "react-icons/pi";
import { ExploreSeriesType } from "shared/enterprise";
import MetricExplorerSettings from "./SideBar/MetricExplorerSettings";
import { ExplorerProvider } from "./ExplorerContext";
import ExplorerMainSection from "./MainSection/ExplorerMainSection";

export const getSeriesIcon = (type: ExploreSeriesType, size = 16) => {
  const icons: Record<ExploreSeriesType, React.ReactNode> = {
    metric: <PiChartBar size={size} />,
    factTable: <PiTable size={size} />,
    sql: <PiCode size={size} />,
  };
  return icons[type];
};

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
        <MetricExplorerSettings />
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
