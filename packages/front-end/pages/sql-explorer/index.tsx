import React, { useState } from "react";
import { isProjectListValidForProject } from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import LinkButton from "@/components/Radix/LinkButton";
import Button from "@/components/Radix/Button";
import SqlExplorerModal from "@/components/SchemaBrowser/SqlExplorerModal";

export default function SqlExplorer() {
  const { datasources, project } = useDefinitions();
  const [showModal, setShowModal] = useState(false);

  const hasDatasource = datasources.some((d) =>
    isProjectListValidForProject(d.projects, project)
  );

  // MKTODO: Once we build the saved queries feature, update this
  const hasSavedQueries = false;

  return (
    <div className="container pagecontents">
      <h1 className="mb-4">SQL Explorer</h1>
      {!hasSavedQueries ? (
        <div className="appbox p-5 text-center">
          <h2>Easily Explore Your Data Sources</h2>
          <p>
            Our SQL Explorer allows you to easily explore your data sources,
            write one-off queries and build visualizations from the results.
          </p>
          <div className="mt-3">
            {!hasDatasource ? (
              <LinkButton href="/datasources">Connect Data Source</LinkButton>
            ) : (
              <Button onClick={() => setShowModal(true)}>
                Start Exploring
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div>Saved Queries go here</div>
      )}

      {showModal && <SqlExplorerModal close={() => setShowModal(false)} />}
    </div>
  );
}
