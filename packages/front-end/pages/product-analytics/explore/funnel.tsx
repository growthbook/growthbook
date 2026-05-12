import React from "react";
import { Box } from "@radix-ui/themes";
import Explorer from "@/enterprise/components/ProductAnalytics/Explorer";
import PageHead from "@/components/Layout/PageHead";

export default function FunnelExplorePage() {
  return (
    <Box className="position-relative" style={{ padding: "8px" }}>
      <PageHead
        breadcrumb={[
          {
            display: "Explore",
            href: "/product-analytics/explore",
          },
          {
            display: "Funnel",
          },
        ]}
      />
      <Box width="100%">
        <Explorer type="funnel" />
      </Box>
    </Box>
  );
}
