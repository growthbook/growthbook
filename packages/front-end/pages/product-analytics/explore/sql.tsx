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
