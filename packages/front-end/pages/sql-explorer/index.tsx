import React, { useState } from "react";
import { isProjectListValidForProject } from "shared/util";
import { SavedQuery } from "shared/validators";
import { Flex } from "@radix-ui/themes";
import { useDefinitions } from "@/services/DefinitionsContext";
import useApi from "@/hooks/useApi";
import Text from "@/ui/Text";
import LinkButton from "@/ui/LinkButton";
import Button from "@/ui/Button";
import LoadingOverlay from "@/components/LoadingOverlay";
import SqlExplorerModal from "@/components/SchemaBrowser/SqlExplorerModal";
import SavedQueriesList from "@/components/SavedQueries/SavedQueriesList";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import PremiumCallout from "@/ui/PremiumCallout";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";

export default function SqlExplorer() {
  const { datasources, project } = useDefinitions();
  const [showModal, setShowModal] = useState(false);

  const { data, error, mutate } = useApi<{
    status: number;
    savedQueries: SavedQuery[];
  }>("/saved-queries");

  const hasDatasource = datasources.some((d) =>
    isProjectListValidForProject(d.projects, project),
  );

  const permissionsUtil = usePermissionsUtil();

  const canCreateSavedQueries = permissionsUtil.canCreateSqlExplorerQueries({
    projects: [project],
  });

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

  return (
    <div className="container pagecontents">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1>Custom SQL Reports</h1>
        {hasDatasource && canCreateSavedQueries && (
          <Button onClick={() => setShowModal(true)}>New SQL Report</Button>
        )}
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
          <Flex direction="row" gap="2">
            <Text weight="semibold">New Feature!</Text>
            <Text>
              Use our{" "}
              <Link href="/product-analytics/explore/new">
                Product Analytics Explore
              </Link>{" "}
              tool to create visualizations from your data without writing any
              SQL.
            </Text>
          </Flex>
        </Callout>
      </div>

      {!hasSavedQueries ? (
        <>
          <div className="appbox p-5 text-center">
            <h2>Explore Your Data</h2>
            <p>
              Write custom SQL queries, create visualizations from the results,
              and optionally add them to your Product Analytics Dashboards.
            </p>
            <div className="mt-3">
              {!hasDatasource ? (
                <LinkButton href="/datasources">Connect Data Source</LinkButton>
              ) : canCreateSavedQueries ? (
                <Button onClick={() => setShowModal(true)}>
                  Start Exploring
                </Button>
              ) : null}
            </div>

            <div className="mt-5">
              <img
                src="/images/empty-states/sql-explorer.png"
                alt={"SQL Explorer"}
                style={{ width: "100%", maxWidth: "900px", height: "auto" }}
              />
            </div>
          </div>
        </>
      ) : (
        <div>
          <div className="mb-3">
            <p className="text-muted">
              Write custom SQL queries, create visualizations from the results,
              and optionally add them to your Product Analytics Dashboards.
            </p>
          </div>
          <SavedQueriesList savedQueries={savedQueries} mutate={mutate} />
        </div>
      )}

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
