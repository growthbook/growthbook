import React from "react";
import { Box } from "@radix-ui/themes";
import MetricExplorer from "./Explorer";

export default function ExploreWorkspace() {
  return (
    <div className="position-relative" style={{ padding: "8px" }}>
      <Box width="100%">
        <MetricExplorer />
      </Box>
    </div>
  );
}
