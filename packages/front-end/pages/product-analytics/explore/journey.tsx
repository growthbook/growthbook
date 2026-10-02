import React from "react";
import { Box } from "@radix-ui/themes";
import Explorer from "@/enterprise/components/ProductAnalytics/Explorer";
import PageHead from "@/components/Layout/PageHead";

export default function JourneyExplorePage() {
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
