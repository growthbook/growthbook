import React from "react";
import { Box } from "@radix-ui/themes";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { AppFeatures } from "shared/types/app-features";
import Explorer from "@/enterprise/components/ProductAnalytics/Explorer";
import PageHead from "@/components/Layout/PageHead";
import Custom404 from "@/pages/404";

export default function FunnelExplorePage() {
  const gb = useGrowthBook<AppFeatures>();
  const funnelExplorerEnabled = !!gb?.isOn("product-analytics-funnels");

  if (!funnelExplorerEnabled) {
    return <Custom404 />;
  }

  return (
    <Box position="relative" style={{ padding: "8px" }}>
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
