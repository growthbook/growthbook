import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useOptionalSqlEditorContext } from "@/enterprise/components/ProductAnalytics/SqlEditorContext";
import DataSourcePicker from "@/components/DataSourcePicker";

export default function DataSourceDropdown() {
  const { draftExploreState, clearAllDatasets, isSubmittable } =
    useExplorerContext();
  const isQueryRunning = useOptionalSqlEditorContext()?.isQueryRunning ?? false;
  const { datasources } = useDefinitions();

  return (
    <DataSourcePicker
      value={draftExploreState?.datasource}
      options={datasources}
      onChange={clearAllDatasets}
      disabled={isQueryRunning}
      confirmMessage={
        isSubmittable
          ? (name) =>
              `Changing the Data Source clears your current exploration. Switch to "${name}"?`
          : null
      }
    />
  );
}
