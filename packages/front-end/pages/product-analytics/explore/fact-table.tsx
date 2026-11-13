import React from "react";
import { Box } from "@radix-ui/themes";
import Explorer from "@/enterprise/components/ProductAnalytics/Explorer";
import PageHead from "@/components/Layout/PageHead";

export default function FactTableExplorePage() {
  return (
    <Box
      className="position-relative"
      // The page frame's side and top padding, less the explorer's own 8px
      // inside, so it lines up with pages in the frame.
      style={{
        padding:
          "calc(var(--page-top-padding) - var(--space-2)) calc(var(--page-padding) - var(--space-2)) 8px",
        ...({
          "--explorer-frame-y": "var(--page-top-padding)",
        } as React.CSSProperties),
      }}
    >
      <PageHead
        breadcrumb={[
          {
            display: "Explore",
            href: "/product-analytics/explore",
          },
          {
            display: "Fact Table",
          },
        ]}
      />
      <Box width="100%">
        <Explorer type="fact_table" />
      </Box>
    </Box>
  );
}

FactTableExplorePage.noPageWrapper = true;
