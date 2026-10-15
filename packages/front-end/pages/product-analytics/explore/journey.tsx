import React from "react";
import { Box } from "@radix-ui/themes";
import Explorer from "@/enterprise/components/ProductAnalytics/Explorer";
import PageHead from "@/components/Layout/PageHead";

export default function JourneyExplorePage() {
  return (
    <Box
      position="relative"
      // PROTOTYPE (set in review): the explorer's content 32px from the
      // side nav and the window's edge, as the app-wide page padding
      // (global.scss), this page having its own wrapper: 20px on the left
      // and 24px on the right, as the explorer adds 12px (its chart area)
      // and 8px (its sidebar) inside (tried 32px either side: 44px and
      // 40px in all). 8px above and below, as before.
      style={{ padding: "8px 24px 8px 20px" }}
    >
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
