import { CSSProperties, FC, ReactNode, useCallback, useState } from "react";
import { FaPencilAlt } from "react-icons/fa";
import usePermissions from "@/hooks/usePermissions";
import { checkDatasourceProjectPermissions } from "@/services/datasources";
import { DataSourceQueryEditingModalBaseProps } from "../types";
import { EditDataSourcePipeline } from "./EditDataSourcePipeline";

type DataSourcePipelineProps = DataSourceQueryEditingModalBaseProps;

const DataSourcePipelineField: FC<{
  title?: string;
  style?: CSSProperties;
  children?: ReactNode;
  titleClassName?: string;
}> = ({ children, title = "", titleClassName = "", style }) => {
  return (
    <div className={`mb-2 ma-5 ${titleClassName}`} style={style}>
      {title}
      {children}
    </div>
  );
};

export default function DataSourcePipeline({
  dataSource,
  onSave,
  canEdit,
}: DataSourcePipelineProps) {
  const [uiMode, setUiMode] = useState<"view" | "edit">("view");

  const handleCancel = useCallback(() => {
    setUiMode("view");
  }, []);
  const permissions = usePermissions();
  canEdit =
    canEdit &&
    checkDatasourceProjectPermissions(
      dataSource,
      permissions,
      "editDatasourceSettings"
    );

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
        <DataSourcePipelineField
          title="Pipeline Mode: "
          titleClassName="font-weight-bold"
        >
          {dataSource.settings.pipelineSettings?.allowWriting
            ? "Enabled"
            : "Disabled"}
        </DataSourcePipelineField>
        {dataSource.settings.pipelineSettings?.allowWriting && (
          <>
            <DataSourcePipelineField title="Destination dataset: ">
              {dataSource.settings.pipelineSettings?.writeDataset ? (
                <code>{dataSource.settings.pipelineSettings.writeDataset}</code>
              ) : (
                <em className="text-muted">not specified</em>
              )}
            </DataSourcePipelineField>
            <DataSourcePipelineField title="Retention of temporary units table (hours): ">
              {dataSource.settings.pipelineSettings?.unitsTableRetentionHours}
            </DataSourcePipelineField>
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
