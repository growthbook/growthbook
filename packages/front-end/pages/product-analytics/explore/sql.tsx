import React from "react";
import { Box } from "@radix-ui/themes";
import { SavedQuery } from "shared/validators";
import Explorer from "@/enterprise/components/ProductAnalytics/Explorer";
import PageHead from "@/components/Layout/PageHead";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import useApi from "@/hooks/useApi";

export default function SqlExplorePage() {
  const { data } = useApi<{
    status: number;
    savedQueries: SavedQuery[];
  }>("/saved-queries");

  const hasSavedQueries = (data?.savedQueries.length ?? 0) > 0;

  return (
    <Box
      className="position-relative"
      // PROTOTYPE (set in review): the explorer in the app-wide page frame
      // (global.scss), this page having its own wrapper: its content 32px
      // from the side nav and the window's edge, and 24px under the header.
      // The SQL explorer adds 8px on the sides and 4px above its data source
      // picker, so 24px either side and 20px on top (was 8px, 12px in all),
      // and 24px below, with its 8px inside (32px in all; was 8px). The
      // explorer fills the window between: 100vh less 44px, 20px and 24px.
      style={
        {
          padding: "20px 24px 24px 24px",
          "--explorer-chrome": "88px",
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
            display: "SQL",
          },
        ]}
      />
      <Box width="100%">
        {hasSavedQueries ? (
          <Callout status="warning" mb="3" dismissible id="legacy-sql-reports">
            SQL Reports have been deprecated. Use this SQL explorer instead, or{" "}
            <Link href="/sql-explorer">view the old SQL Reports</Link>.
          </Callout>
        ) : null}
        <Explorer type="sql" />
      </Box>
    </Box>
  );
}
