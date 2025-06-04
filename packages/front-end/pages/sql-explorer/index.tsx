import React from "react";
import { isProjectListValidForProject } from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import LinkButton from "@/components/Radix/LinkButton";
import Button from "@/components/Radix/Button";

export default function SqlExplorer() {
  const { datasources, project } = useDefinitions();
  const hasDatasource = datasources.some((d) =>
    isProjectListValidForProject(d.projects, project)
  );
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
              <Button onClick={() => console.log("Start Exploring")}>
                Start Exploring
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div>Saved Queries go here</div>
      )}
    </div>
  );
}
