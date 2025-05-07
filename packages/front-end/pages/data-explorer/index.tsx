import { isProjectListValidForProject } from "shared/util";
import { FC, useEffect, useState } from "react";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "@/components/Forms/SelectField";
import DataExplorer from "@/components/SchemaBrowser/DataExplorer";
import Callout from "@/components/Radix/Callout";

const DataExplorerPage: FC = () => {
  const { projectId: demoProjectId } = useDemoDataSourceProject();
  const { project, datasources } = useDefinitions();
  const filteredDatasources = (
    project
      ? datasources.filter((ds) =>
          isProjectListValidForProject(ds.projects, project)
        )
      : datasources
  ).filter((ds) => !ds.projects?.includes(demoProjectId || ""));
  const [selectedDatasourceId, setSelectedDataSourceId] = useState<
    string | null
  >(null);
  const [datasource, setDataSource] =
    useState<DataSourceInterfaceWithParams | null>(null);

  useEffect(() => {
    if (selectedDatasourceId) {
      const datasource = filteredDatasources.find(
        (ds) => ds.id === selectedDatasourceId
      );
      if (datasource) {
        setDataSource(datasource);
      }
    }
  }, [filteredDatasources, selectedDatasourceId]);

  return (
    <div className="p-3">
      <div className="border-bottom">
        <SelectField
          style={{ maxWidth: "33vw" }}
          label="Select A Data Source to explore"
          value={selectedDatasourceId || ""}
          onChange={(datasourceId) => {
            setSelectedDataSourceId(datasourceId);
          }}
          options={(datasources || []).map((d) => ({
            value: d.id,
            label: `${d.name}${d.description ? ` — ${d.description}` : ""}`,
          }))}
          className="portal-overflow-ellipsis"
          name="datasource"
        />
      </div>
      {selectedDatasourceId ? (
        <div className="pt-3">
          {datasource ? (
            <DataExplorer datasource={datasource} />
          ) : (
            <Callout status="warning">Data Explorer not available</Callout>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default DataExplorerPage;
