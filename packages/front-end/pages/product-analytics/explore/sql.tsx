import { SavedQuery } from "shared/validators";
import ExplorerPage from "@/enterprise/components/ProductAnalytics/ExplorerPage";
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
    <ExplorerPage
      type="sql"
      breadcrumb={[
        { display: "Explore", href: "/product-analytics/explore" },
        { display: "SQL" },
      ]}
    >
      {hasSavedQueries ? (
        <Callout status="warning" mb="3" dismissible id="legacy-sql-reports">
          SQL Reports have been deprecated. Use this SQL explorer instead, or{" "}
          <Link href="/sql-explorer">view the old SQL Reports</Link>.
        </Callout>
      ) : null}
    </ExplorerPage>
  );
}

SqlExplorePage.noPageWrapper = true;
