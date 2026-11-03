import { FC } from "react";
import { isProjectListValidForProject } from "shared/util";
import { useRouter } from "next/router";
import DataSources from "@/components/Settings/DataSources";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "@/ui/Button";
import { hasFileConfig } from "@/services/env";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import DataSourceOptionsTable from "@/components/DataSourceSetup/DataSourceOptionsTable";

const DataSourcesPage: FC = () => {
  const { projectId: demoProjectId } = useDemoDataSourceProject();
  const { project, projects, datasources } = useDefinitions();

  const router = useRouter();

  const filteredDatasources = project
    ? datasources.filter((ds) =>
        isProjectListValidForProject(ds.projects, project),
      )
    : // "All Projects" — hide the sample datasource so it doesn't muddle the view
      datasources.filter((ds) => !ds.projects?.includes(demoProjectId || ""));

  const permissionsUtil = usePermissionsUtil();

  if (filteredDatasources.length === 0) {
    return (
      <div className="container-fluid pagecontents">
        <h1 className="mb-3">Data Sources</h1>
        <DataSourceOptionsTable />
      </div>
    );
  }

  return (
    <div className="container-fluid pagecontents">
      <div className="d-flex align-items-center mb-3">
        <h1>Data Sources</h1>
        <div className="ml-auto" />
        {!hasFileConfig() && (
          <Tooltip
            body="You don't have permission to add data sources in this project."
            shouldDisplay={
              !permissionsUtil.canViewCreateDataSourceModal(project, projects)
            }
          >
            <Button
              disabled={
                !permissionsUtil.canViewCreateDataSourceModal(project, projects)
              }
              onClick={() => router.push("/datasources/new")}
              ml="2"
            >
              Add Data Source
            </Button>
          </Tooltip>
        )}
      </div>
      <DataSources />
    </div>
  );
};
export default DataSourcesPage;
