import React from "react";
import { Box } from "@radix-ui/themes";
import Explorer from "@/enterprise/components/ProductAnalytics/Explorer";
import PageHead from "@/components/Layout/PageHead";

export default function FunnelExplorePage() {
  return (
    <Box
      className="position-relative page-sides"
      // The page's side padding, less the explorer's own 8px inside, and the
      // wrapper's top padding from the header to the explorer's first row
      // (with the explorer's own 8px), as on pages in the wrapper.
      style={{
        paddingTop: "calc(var(--page-top-padding) - var(--space-2))",
        paddingBottom: "8px",
        ...({
          "--page-sides-inset": "var(--space-2)",
          "--explorer-frame-y": "var(--page-top-padding)",
        } as React.CSSProperties),
      }}
    >
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

FunnelExplorePage.noPageWrapper = true;
