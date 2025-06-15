import React, { useState } from "react";
import { isProjectListValidForProject } from "shared/util";
import { SavedQuery } from "back-end/src/validators/saved-queries";
import { useDefinitions } from "@/services/DefinitionsContext";
import useApi from "@/hooks/useApi";
import LinkButton from "@/components/Radix/LinkButton";
import Button from "@/components/Radix/Button";
import LoadingOverlay from "@/components/LoadingOverlay";
import SqlExplorerModal from "@/components/SchemaBrowser/SqlExplorerModal";
import SavedQueriesList from "@/components/SavedQueries/SavedQueriesList";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import PremiumCallout from "@/components/Radix/PremiumCallout";

export default function SqlExplorer() {
  const { datasources, project } = useDefinitions();
  const [showModal, setShowModal] = useState(false);

  const { data, error, mutate } = useApi<{
    status: number;
    savedQueries: SavedQuery[];
  }>("/saved-queries");

  const hasDatasource = datasources.some((d) =>
    isProjectListValidForProject(d.projects, project)
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
        <h1>SQL Explorer</h1>
        {hasDatasource && canCreateSavedQueries && (
          <Button onClick={() => setShowModal(true)}>New SQL Query</Button>
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

      {!hasSavedQueries ? (
        <>
          <div className="appbox p-5 text-center">
            <h2>Explore Your Data</h2>
            <p>
              Write SQL, view results, create visualizations, and share with
              your team.
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
              Write SQL, view results, create visualizations, and share with
              your team.
            </p>
          </div>
          <SavedQueriesList savedQueries={savedQueries} mutate={mutate} />
        </div>
      )}

      {showModal && (
        <SqlExplorerModal close={() => setShowModal(false)} mutate={mutate} />
      )}
    </div>
  );
}
