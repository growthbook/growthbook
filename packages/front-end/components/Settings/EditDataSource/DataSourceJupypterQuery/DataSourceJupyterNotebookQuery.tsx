import React, { FC, useCallback, useState } from "react";
import { FaPencilAlt, FaPlus } from "react-icons/fa";
import Code from "@/components/SyntaxHighlighting/Code";
import usePermissions from "@/hooks/usePermissions";
import { DataSourceQueryEditingModalBaseProps } from "../types";
import { EditJupyterNotebookQueryRunner } from "./EditJupyterNotebookQueryRunner";

type DataSourceJupyterNotebookQueryProps = DataSourceQueryEditingModalBaseProps;

export const DataSourceJupyterNotebookQuery: FC<DataSourceJupyterNotebookQueryProps> = ({
  onSave,
  dataSource,
}) => {
  const [uiMode, setUiMode] = useState<"view" | "edit">("view");
  const permissions = usePermissions();
  const canEdit = permissions.editDatasourceSettings;

  const handleCancel = useCallback(() => {
    setUiMode("view");
  }, []);

  if (!dataSource) {
    console.error("ImplementationError: dataSource cannot be null");
    return null;
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center">
        <div className="">
          <h3>Jupyter Notebook Query Runner</h3>
        </div>

        {canEdit && (
          <div className="">
            <button
              className="btn btn-outline-primary font-weight-bold"
              onClick={() => {
                setUiMode("edit");
              }}
            >
              {dataSource.settings.notebookRunQuery ? (
                <>
                  <FaPencilAlt className="mr-1" /> Edit
                </>
              ) : (
                <>
                  <FaPlus className="mr-1" /> Add
                </>
              )}
            </button>
          </div>
        )}
      </div>
      <p>
        Tell us how to query this data source from within a Jupyter notebook
        environment.
      </p>
      {dataSource.settings?.notebookRunQuery ? (
        <Code
          code={dataSource.settings.notebookRunQuery}
          language="python"
          expandable={true}
        />
      ) : (
        <div className="alert alert-info">
          Used when exporting experiment results to a Jupyter notebook
        </div>
      )}

      {uiMode === "edit" ? (
        <EditJupyterNotebookQueryRunner
          onSave={onSave}
          onCancel={handleCancel}
          dataSource={dataSource}
        />
      ) : null}
    </div>
  );
};
