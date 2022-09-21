import { DataSourceQueryEditingModalBaseProps } from "../types";
import React, { FC, useCallback, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import cloneDeep from "lodash/cloneDeep";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import Modal from "../../../Modal";
import Field from "../../../Forms/Field";
import { EditIdentifierType } from "./EditIdentifierType";
import MoreMenu from "../../../Dropdown/MoreMenu";
import { FaCog, FaPencilAlt, FaTrash } from "react-icons/fa";

type DataSourceInlineEditIdentifierTypesProps = DataSourceQueryEditingModalBaseProps;

export const DataSourceInlineEditIdentifierTypes: FC<DataSourceInlineEditIdentifierTypesProps> = ({
  dataSource,
  onSave,
  onCancel,
}) => {
  const [uiMode, setUiMode] = useState<"view" | "edit" | "add">("view");
  const [editingIndex, setEditingIndex] = useState<number>(-1);

  const handleCancel = useCallback(() => {
    setUiMode("view");
    onCancel();
  }, [onCancel]);

  const handleActionEditClicked = useCallback(
    (idx: number) => () => {
      console.log("handleActionEditClicked", idx);
    },
    [dataSource]
  );

  const handleActionDeleteClicked = useCallback(
    (idx: number) => () => {
      console.log("handleActionDeleteClicked", idx);
    },
    [dataSource]
  );

  const handleSave = useCallback(
    (idx: number) => (userIdType: string, description: string) => {
      const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
      copy.settings.userIdTypes[idx] = {
        userIdType,
        description,
      };

      console.log("should save new", copy);
      // TODO: API call
      // TODO: mutate
      // TODO: change uiMode and editingIndex
    },
    [dataSource]
  );

  // const form = useForm({
  //   defaultValues: {
  //     userIdTypes: dataSource.settings.userIdTypes,
  //   },
  // });
  //
  // const userIdTypes = useFieldArray({
  //   control: form.control,
  //   name: "userIdTypes",
  // });
  //
  // const handleSubmit = form.handleSubmit(async (value) => {
  //   const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
  //   copy.settings.userIdTypes = value.userIdTypes;
  //   onSave(copy);
  // });

  if (!dataSource) {
    console.error("ImplementationError: dataSource cannot be null");
    return null;
  }

  const userIdTypes = dataSource.settings?.userIdTypes || [];

  return (
    <div className="mb-5">
      <h3>Identifier Types</h3>
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
              <button
                className="dropdown-item py-2 text-danger"
                onClick={handleActionDeleteClicked(idx)}
              >
                <FaTrash className="mr-2" /> Delete
              </button>
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
    </div>
  );
};
