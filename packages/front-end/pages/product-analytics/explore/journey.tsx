import React from "react";
import { Box } from "@radix-ui/themes";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { AppFeatures } from "shared/types/app-features";
import Explorer from "@/enterprise/components/ProductAnalytics/Explorer";
import PageHead from "@/components/Layout/PageHead";
import Custom404 from "@/pages/404";

export default function JourneyExplorePage() {
  const gb = useGrowthBook<AppFeatures>();
  if (!gb?.isOn("product-analytics-journeys")) {
    return <Custom404 />;
  }

  return (
    <Box position="relative" style={{ padding: "8px" }}>
      <PageHead
        breadcrumb={[
          {
            display: "User Journeys",
          },
        ]}
      />
      <Box width="100%">
        <Explorer type="journey" />
      </Box>
    </Box>
  );
}
