import { DataSourceQueryEditingModalBaseProps } from "../types";
import React, { FC, useCallback, useMemo, useState } from "react";
import cloneDeep from "lodash/cloneDeep";
import {
  DataSourceInterfaceWithParams,
  UserIdType,
} from "back-end/types/datasource";
import { EditIdentifierType } from "./EditIdentifierType";
import MoreMenu from "../../../Dropdown/MoreMenu";
import { FaPencilAlt, FaPlus } from "react-icons/fa";
import DeleteButton from "../../../DeleteButton";

type DataSourceInlineEditIdentifierTypesProps = DataSourceQueryEditingModalBaseProps;

export const DataSourceInlineEditIdentifierTypes: FC<DataSourceInlineEditIdentifierTypesProps> = ({
  dataSource,
  onSave,
  onCancel,
}) => {
  const [uiMode, setUiMode] = useState<"view" | "edit" | "add">("view");
  const [editingIndex, setEditingIndex] = useState<number>(-1);

  const userIdTypes = dataSource.settings?.userIdTypes || [];

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

      onSave(copy);
    },
    [userIdTypes, onSave, dataSource]
  );

  const handleSave = useCallback(
    (idx: number) => (userIdType: string, description: string) => {
      const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
      copy.settings.userIdTypes[idx] = {
        userIdType,
        description,
      };

      onSave(copy);
    },
    [dataSource, onSave]
  );

  if (!dataSource) {
    console.error("ImplementationError: dataSource cannot be null");
    return null;
  }

  return (
    <div className="my-5">
      <div className="d-flex justify-content-between align-items-center">
        <div className="">
          <h3>Identifier Types</h3>
        </div>

        <div className="">
          <button
            className="btn btn-outline-secondary"
            onClick={() => {
              setUiMode("add");
              setEditingIndex(userIdTypes.length);
            }}
          >
            <FaPlus className="mr-1" /> Add
          </button>
        </div>
      </div>

      <p>The different units you use to split traffic in an experiment.</p>

      {userIdTypes.map(({ userIdType, description }, idx) => (
        <div
          className="d-flex justify-content-between align-items-center bg-white border mb-3 p-3 "
          key={userIdType}
        >
          {/* region Identity Type text */}
          <div>
            <h4>{userIdType}</h4>
            {description ? (
              <span>{description}</span>
            ) : (
              <span className="text-muted">(no description)</span>
            )}
          </div>
          {/* endregion Identity Type text */}

          {/* region Identity Type actions */}
          <div>
            <MoreMenu id="DataSourceInlineEditIdentifierTypes_identifier-types">
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
          {/* endregion Identity Type actions */}
        </div>
      ))}

      {/* region Identity Type empty state */}
      {userIdTypes.length === 0 ? (
        <div>
          <p className="mb-2">No user identifier types.</p>

          <button className="btn btn-outline">Add</button>
        </div>
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
        />
      ) : null}
      {/* endregion Add/Edit modal */}
    </div>
  );
};
