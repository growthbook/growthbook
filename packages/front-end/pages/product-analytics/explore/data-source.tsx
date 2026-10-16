import React from "react";
import { Box } from "@radix-ui/themes";
import Explorer from "@/enterprise/components/ProductAnalytics/Explorer";
import PageHead from "@/components/Layout/PageHead";

export default function DataSourceExplorePage() {
  return (
    <Box
      className="position-relative"
      // PROTOTYPE (set in review): the explorer in the app-wide page frame
      // (global.scss), this page having its own wrapper: its content 32px
      // from the side nav and the window's edge, and 24px under the header.
      // The explorer adds 12px inside (its chart area; 8px at its sidebar),
      // so 20px left, 24px right, 12px on top (was 8px, 20px in all) and
      // 20px below (32px in all; was 8px). The explorer fills the window
      // between them: 100vh less the 44px header, 12px and 20px.
      style={
        {
          padding: "12px 24px 20px 20px",
          "--explorer-chrome": "76px",
        } as React.CSSProperties
      }
    >
      <PageHead
        breadcrumb={[
          {
            display: "Explore",
            href: "/product-analytics/explore",
          },
          {
            display: "Data Source",
          },
        ]}
      />
      <Box width="100%">
        <Explorer type="data_source" />
      </Box>
    </Box>
  );
}
