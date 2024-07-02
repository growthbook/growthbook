import { useCallback, useState } from "react";
import { FaPencilAlt } from "react-icons/fa";
import { DataSourceType } from "back-end/types/datasource";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { EditDataSourcePipeline } from "./EditDataSourcePipeline";

type DataSourcePipelineProps = DataSourceQueryEditingModalBaseProps;

export function dataSourcePathNames(
  dataSourceType: DataSourceType
): { databaseName: string; schemaName: string } {
  let databaseName = "database";
  let schemaName = "schema";
  if (dataSourceType === "bigquery") {
    databaseName = "project";
    schemaName = "dataset";
  }
  if (dataSourceType === "databricks") {
    databaseName = "catalog";
  }
  return { databaseName, schemaName };
}

export default function DataSourcePipeline({
  dataSource,
  onSave,
  canEdit,
}: DataSourcePipelineProps) {
  const [uiMode, setUiMode] = useState<"view" | "edit">("view");

  const pipelineSettings = dataSource.settings.pipelineSettings;

  const handleCancel = useCallback(() => {
    setUiMode("view");
  }, []);
  const permissionsUtil = usePermissionsUtil();
  canEdit = canEdit && permissionsUtil.canUpdateDataSourceSettings(dataSource);

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <div className="d-flex justify-space-between align-items-center">
          <h3>Data Pipeline Settings</h3>
          <span className="badge badge-purple text-uppercase mx-2">Beta</span>
        </div>
        {canEdit && (
          <div className="">
            <button
              className="btn btn-outline-primary font-weight-bold"
              onClick={() => {
                setUiMode("edit");
              }}
            >
              <FaPencilAlt className="mr-1" /> Edit
            </button>
          </div>
        )}
      </div>
      <div className="alert alert-info">
        In this section, you can configure how GrowthBook can use write
        permissions to your Data Source to improve the performance of experiment
        queries.
      </div>
      <div>
        <div className={`mb-2 ma-5 font-weight-bold`}>
          {"Pipeline Mode: "}
          {pipelineSettings?.allowWriting ? "Enabled" : "Disabled"}
        </div>
        {pipelineSettings?.allowWriting && (
          <>
            <div className={`mb-2 ma-5`}>
              {`Destination ${
                dataSourcePathNames(dataSource.type).schemaName
              }: `}
              {pipelineSettings?.writeDataset ? (
                <code>{`${
                  pipelineSettings?.writeDatabase
                    ? pipelineSettings?.writeDatabase + "."
                    : ""
                }${pipelineSettings.writeDataset}`}</code>
              ) : (
                <em className="text-muted">not specified</em>
              )}
            </div>
            {dataSource.type === "databricks" ? (
              <div className={`mb-2 ma-5`}>
                {"Drop units table when analysis finishes (recommended): "}
                {pipelineSettings?.unitsTableDeletion ? "Enabled" : "Disabled"}
              </div>
            ) : (
              <div className={`mb-2 ma-5`}>
                {"Retention of temporary units table (hours): "}
                {pipelineSettings?.unitsTableRetentionHours ?? 24}
              </div>
            )}
          </>
        )}
      </div>

      {uiMode === "edit" ? (
        <EditDataSourcePipeline
          onSave={onSave}
          onCancel={handleCancel}
          dataSource={dataSource}
        />
      ) : null}
    </div>
  );
}
