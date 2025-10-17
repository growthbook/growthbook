import React, { useState } from "react";
import { SavedQuery } from "back-end/src/validators/saved-queries";
import { useRouter } from "next/router";
import { PiArrowSquareOut } from "react-icons/pi";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import SqlExplorerModal from "@/components/SchemaBrowser/SqlExplorerModal";
import SavedQueriesList from "@/components/SavedQueries/SavedQueriesList";
import PremiumCallout from "@/ui/PremiumCallout";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";

export default function SqlExplorer() {
  const [showModal, setShowModal] = useState(false);
  const router = useRouter();

  const { data, error, mutate } = useApi<{
    status: number;
    savedQueries: SavedQuery[];
  }>("/saved-queries");

  const savedQueries = data?.savedQueries || [];
  const hasSavedQueries = savedQueries.length > 0;

  if (error) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          Failed to load saved queries: {error.message}
        </div>
      </div>
    );
  }

  if (!data) {
    return <LoadingOverlay />;
  }

  if (!hasSavedQueries) {
    router.replace("/404");
    return;
  }

  return (
    <div className="container pagecontents">
      <div className="d-flex justify-content-between align-items-center">
        <h1>SQL Explorer</h1>
      </div>

      <div className="mb-2">
        <PremiumCallout
          id="save-sql-explorer-queries"
          commercialFeature="saveSqlExplorerQueries"
        >
          <span>
            Save your commonly run queries and build visualizations from the
            results.
          </span>
        </PremiumCallout>
      </div>
      <div className="mb-2">
        <Callout status="info">
          <span>
            SQL Explorer is now part of <b>Product Analytics</b>. Add SQL
            queries and visualizations as blocks within Dashboards.{" "}
            <div className="d-inline-block">
              <Link
                underline="always"
                style={{ display: "flex", alignItems: "center", gap: 3 }}
                href="/dashboards"
              >
                Take me there
                <PiArrowSquareOut />
              </Link>
            </div>
          </span>
        </Callout>
      </div>

      <div>
        <SavedQueriesList savedQueries={savedQueries} mutate={mutate} />
      </div>

      {showModal && (
        <SqlExplorerModal
          close={() => setShowModal(false)}
          mutate={mutate}
          trackingEventModalSource="saved-queries-index-page"
        />
      )}
    </div>
  );
}
