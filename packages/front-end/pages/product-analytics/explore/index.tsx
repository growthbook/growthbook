import React from "react";
import { Box } from "@radix-ui/themes";
import EmptyState from "@/enterprise/components/ProductAnalytics/EmptyState";

export default function ExplorePage() {
  return (
    <Box className="position-relative" style={{ padding: "8px" }}>
      <Box width="100%">
        <EmptyState />
      </Box>
    </Box>
  );
}
