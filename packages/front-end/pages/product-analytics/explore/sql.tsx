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
    <Box className="position-relative" style={{ padding: "8px" }}>
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
