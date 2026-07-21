import React from "react";
import { Box } from "@radix-ui/themes";
import Explorer from "@/enterprise/components/ProductAnalytics/Explorer";
import PageHead from "@/components/Layout/PageHead";

export default function FunnelExplorePage() {
  return (
    <Box position="relative" style={{ padding: "8px" }}>
      <PageHead
        breadcrumb={[
          {
            display: "Funnels",
          },
        ]}
      />
      <Box width="100%">
        <Explorer type="funnel" />
      </Box>
    </Box>
  );
}
