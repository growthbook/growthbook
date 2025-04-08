import React, { FC, useCallback, useState } from "react";
import { FaPencilAlt } from "react-icons/fa";
import {
  DataSourceEvents,
  DataSourceInterfaceWithParams,
} from "back-end/types/datasource";
import cloneDeep from "lodash/cloneDeep";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import { DataSourceEditExperimentEventPropertiesModal } from "@/components/Settings/EditDataSource/DataSourceExperimentProperties/DataSourceEditExperimentEventPropertiesModal";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

type DataSourceViewEditExperimentPropertiesProps = DataSourceQueryEditingModalBaseProps;

export const DataSourceViewEditExperimentProperties: FC<DataSourceViewEditExperimentPropertiesProps> = ({
  onSave,
  onCancel,
  dataSource,
  canEdit = true,
}) => {
  const [uiMode, setUiMode] = useState<"view" | "edit">("view");

  const permissionsUtil = usePermissionsUtil();
  canEdit = canEdit && permissionsUtil.canUpdateDataSourceSettings(dataSource);

  const handleEdit = useCallback(() => {
    setUiMode("edit");
  }, []);

  const handleCancel = useCallback(() => {
    setUiMode("view");
    onCancel();
  }, [onCancel]);

  const handleSave = useCallback(
    async (eventProperties: DataSourceEvents) => {
      const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
      copy.settings.events = eventProperties;
      await onSave(copy);
    },
    [dataSource, onSave]
  );

  if (!dataSource) {
    console.error("ImplementationError: dataSource cannot be null");
    return null;
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h3 className="mb-0">查询设置</h3>

        {canEdit && (
          <div className="">
            <button
              className="btn btn-outline-primary font-weight-bold text-nowrap"
              onClick={handleEdit}
            >
              <FaPencilAlt className="mr-1" /> 编辑
            </button>
          </div>
        )}
      </div>

      <table className="table appbox gbtable mb-5">
        <tbody>
          <tr>
            <th>实验事件</th>
            <td>
              <code>{dataSource.settings?.events?.experimentEvent || ""}</code>
            </td>
          </tr>
          <tr>
            <th>Experiment Id Property</th>
            <td>
              <code>
                {dataSource.settings?.events?.experimentIdProperty || ""}
              </code>
            </td>
          </tr>
          <tr>
            <th>Variation Id Property</th>
            <td>
              <code>
                {dataSource.settings?.events?.variationIdProperty || ""}
              </code>
            </td>
          </tr>
          <tr>
            <th>UserId Property</th>
            <td>
              <code>distinct_id</code>
              {dataSource.settings?.events?.extraUserIdProperty && (
                <>
                  {" "}
                  +{" "}
                  <code>
                    {dataSource.settings?.events?.extraUserIdProperty || ""}
                  </code>
                </>
              )}
            </td>
          </tr>
        </tbody>
      </table>

      {/* region Add/Edit modal */}

      {uiMode === "edit" ? (
        <DataSourceEditExperimentEventPropertiesModal
          dataSource={dataSource}
          onCancel={handleCancel}
          onSave={handleSave}
        />
      ) : null}

      {/* endregion Add/Edit modal */}
    </div>
  );
};
