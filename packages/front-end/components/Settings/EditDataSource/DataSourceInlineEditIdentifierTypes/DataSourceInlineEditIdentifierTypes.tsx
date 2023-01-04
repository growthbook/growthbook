import React, { FC, useCallback, useMemo, useState } from "react";
import cloneDeep from "lodash/cloneDeep";
import {
  DataSourceInterfaceWithParams,
  UserIdType,
} from "back-end/types/datasource";
import { FaPencilAlt, FaPlus } from "react-icons/fa";
import { checkDatasourceProjectPermissions } from "@/services/datasources";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import usePermissions from "@/hooks/usePermissions";
import { EditIdentifierType } from "@/components/Settings/EditDataSource/DataSourceInlineEditIdentifierTypes/EditIdentifierType";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import Tooltip from "@/components/Tooltip/Tooltip";

type DataSourceInlineEditIdentifierTypesProps = DataSourceQueryEditingModalBaseProps;

export const DataSourceInlineEditIdentifierTypes: FC<DataSourceInlineEditIdentifierTypesProps> = ({
  dataSource,
  onSave,
  onCancel,
  canEdit = true,
}) => {
  const [uiMode, setUiMode] = useState<"view" | "edit" | "add">("view");
  const [editingIndex, setEditingIndex] = useState<number>(-1);

  const permissions = usePermissions();
  canEdit =
    canEdit &&
    checkDatasourceProjectPermissions(
      dataSource,
      permissions,
      "editDatasourceSettings"
    );

  const userIdTypes = useMemo(() => dataSource.settings?.userIdTypes || [], [
    dataSource.settings?.userIdTypes,
  ]);

  const recordEditing = useMemo((): null | UserIdType => {
    return userIdTypes[editingIndex] || null;
  }, [editingIndex, userIdTypes]);

  const handleCancel = useCallback(() => {
    setUiMode("view");
    setEditingIndex(-1);
    onCancel();
  }, [onCancel]);

  const handleActionEditClicked = useCallback(
    (idx: number) => () => {
      setEditingIndex(idx);
      setUiMode("edit");
    },
    []
  );

  const handleActionDeleteClicked = useCallback(
    (idx: number) => async () => {
      const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
      copy.settings.userIdTypes.splice(idx, 1);

      await onSave(copy);
    },
    [onSave, dataSource]
  );

  const handleSave = useCallback(
    (idx: number) => async (userIdType: string, description: string) => {
      const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
      copy.settings.userIdTypes[idx] = {
        userIdType,
        description,
      };

      await onSave(copy);
    },
    [dataSource, onSave]
  );

  const handleAdd = useCallback(() => {
    setUiMode("add");
    setEditingIndex(userIdTypes.length);
  }, [userIdTypes]);

  if (!dataSource) {
    console.error("ImplementationError: dataSource cannot be null");
    return null;
  }

  return (
    <div className="">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div className="d-flex align-items-center">
          <h3 className="mb-0">Identifier Types</h3>
          <Tooltip
            className="ml-2"
            body="The different units you use to split traffic in an experiment."
          />
        </div>

        {canEdit && (
          <div className="">
            <button
              className="btn btn-outline-primary font-weight-bold"
              onClick={handleAdd}
            >
              <FaPlus className="mr-1" /> Add
            </button>
          </div>
        )}
      </div>

      {userIdTypes.map(({ userIdType, description }, idx) => (
        <div
          style={{ marginBottom: -1 }}
          className="d-flex justify-content-between align-items-center bg-white border p-2"
          key={userIdType}
        >
          {/* region Identity Type text */}
          <div className="d-flex">
            <p className="mb-0 mr-3 font-weight-bold">{userIdType}</p>
            <span className="text-muted">
              {description || "(no description)"}
            </span>
          </div>
          {/* endregion Identity Type text */}

          {/* region Identity Type actions */}
          {canEdit && (
            <div>
              <MoreMenu>
                <button
                  className="dropdown-item py-2"
                  onClick={handleActionEditClicked(idx)}
                >
                  <FaPencilAlt className="mr-2" /> Edit
                </button>
                <div className="">
                  <DeleteButton
                    onClick={handleActionDeleteClicked(idx)}
                    className="dropdown-item text-danger py-2"
                    iconClassName="mr-2"
                    style={{ borderRadius: 0 }}
                    useIcon
                    displayName={userIdTypes[idx]?.userIdType}
                    deleteMessage={`Are you sure you want to delete identifier type ${userIdTypes[idx]?.userIdType}?`}
                    title="Delete"
                    text="Delete"
                    outline={false}
                  />
                </div>
              </MoreMenu>
            </div>
          )}
          {/* endregion Identity Type actions */}
        </div>
      ))}

      {/* region Identity Type empty state */}
      {userIdTypes.length === 0 ? (
        <div className="mb-0 alert alert-info">No user identifier types.</div>
      ) : null}
      {/* endregion Identity Type empty state */}

      {/* region Add/Edit modal */}
      {uiMode === "edit" || uiMode === "add" ? (
        <EditIdentifierType
          mode={uiMode}
          onCancel={handleCancel}
          userIdType={recordEditing?.userIdType}
          description={recordEditing?.description}
          onSave={handleSave(editingIndex)}
          dataSource={dataSource}
        />
      ) : null}
      {/* endregion Add/Edit modal */}
    </div>
  );
};
