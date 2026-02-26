import React from "react";
import { Box } from "@radix-ui/themes";
import Explorer from "@/enterprise/components/ProductAnalytics/Explorer";
import PageHead from "@/components/Layout/PageHead";

export default function MetricsExplorePage() {
  return (
    <Box className="position-relative" style={{ padding: "8px" }}>
      <PageHead
        breadcrumb={[
          {
            display: "Explore",
            href: "/product-analytics/explore",
          },
          {
            display: "Metrics",
          },
        ]}
      />
      <Box width="100%">
        <Explorer type="metric" />
      </Box>
    </Box>
  );
}
