import React, { FC, useCallback, useMemo, useState } from "react";
import { FaChevronRight, FaPencilAlt, FaPlus } from "react-icons/fa";
import cloneDeep from "lodash/cloneDeep";
import {
  DataSourceInterfaceWithParams,
  IdentityJoinQuery,
} from "back-end/types/datasource";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import { checkDatasourceProjectPermissions } from "@/services/datasources";
import { AddEditIdentityJoinModal } from "@/components/Settings/EditDataSource/DataSourceInlineEditIdentityJoins/AddEditIdentityJoinModal";
import usePermissions from "@/hooks/usePermissions";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Code from "@/components/SyntaxHighlighting/Code";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import Tooltip from "@/components/Tooltip/Tooltip";

type DataSourceInlineEditIdentityJoinsProps = DataSourceQueryEditingModalBaseProps;

export const DataSourceInlineEditIdentityJoins: FC<DataSourceInlineEditIdentityJoinsProps> = ({
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

  const [openIndexes, setOpenIndexes] = useState<boolean[]>([]);

  const handleCancel = useCallback(() => {
    setUiMode("view");
    setEditingIndex(-1);
    onCancel();
  }, [onCancel]);

  const handleExpandCollapseForIndex = useCallback(
    (index) => () => {
      const currentValue = openIndexes[index] || false;
      const updatedOpenIndexes = [...openIndexes];
      updatedOpenIndexes[index] = !currentValue;

      setOpenIndexes(updatedOpenIndexes);
    },
    [openIndexes]
  );

  const userIdTypes = useMemo(() => dataSource.settings?.userIdTypes || [], [
    dataSource.settings?.userIdTypes,
  ]);
  const addIsDisabled = userIdTypes.length < 2;
  const identityJoins = useMemo(
    () => dataSource?.settings?.queries?.identityJoins || [],
    [dataSource?.settings?.queries?.identityJoins]
  );

  const handleAdd = useCallback(() => {
    setUiMode("add");
    setEditingIndex(identityJoins.length);
  }, [identityJoins]);

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

      copy.settings.queries.identityJoins.splice(idx, 1);

      await onSave(copy);
    },
    [onSave, dataSource]
  );

  const handleSave = useCallback(
    (idx: number) => async (identityJoin: IdentityJoinQuery) => {
      const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
      copy.settings.queries.identityJoins[idx] = identityJoin;
      await onSave(copy);
    },
    [dataSource, onSave]
  );

  if (!dataSource) {
    console.error("ImplementationError: dataSource cannot be null");
    return null;
  }

  return (
    <div className="">
      {/* region Heading */}
      {identityJoins.length > 0 || userIdTypes.length >= 2 ? (
        <div className="d-flex justify-content-between align-items-center mb-3">
          <div className="d-flex mt-2">
            <h3>Join Tables</h3>
            <Tooltip
              className="ml-2"
              body="Joins different identifier types together when needed during
              experiment analysis."
            />
          </div>

          {canEdit && (
            <div>
              <button
                disabled={addIsDisabled}
                className="btn btn-outline-primary font-weight-bold"
                onClick={handleAdd}
              >
                <FaPlus className="mr-1" /> Add
              </button>
            </div>
          )}
        </div>
      ) : null}
      {/* endregion Heading */}

      {/* region Identity Joins list */}
      {identityJoins.length > 0 ? (
        <div className="">
          {identityJoins.map((identityJoin, idx) => {
            const isOpen = openIndexes[idx] || false;
            return (
              <div
                style={{ marginBottom: -1 }}
                className="bg-white border"
                key={`identity-join-${idx}`}
              >
                <div className="d-flex justify-content-between">
                  {/* Title */}
                  <h4 className="py-3 px-3 my-0">
                    {identityJoin.ids.join(" ↔ ")}
                  </h4>

                  {/* Actions*/}
                  <div className="d-flex align-items-center">
                    {canEdit && (
                      <MoreMenu>
                        <button
                          className="dropdown-item py-2"
                          onClick={handleActionEditClicked(idx)}
                        >
                          <FaPencilAlt className="mr-2" /> Edit
                        </button>

                        <DeleteButton
                          onClick={handleActionDeleteClicked(idx)}
                          className="dropdown-item text-danger py-2"
                          iconClassName="mr-2"
                          style={{ borderRadius: 0 }}
                          useIcon
                          displayName={identityJoin.ids.join(" ↔ ")}
                          deleteMessage={`Are you sure you want to delete identifier join ${identityJoin.ids.join(
                            " ↔ "
                          )}?`}
                          title="Delete"
                          text="Delete"
                          outline={false}
                        />
                      </MoreMenu>
                    )}

                    <button
                      className="btn ml-3 text-dark"
                      onClick={handleExpandCollapseForIndex(idx)}
                    >
                      <FaChevronRight
                        style={{
                          transform: `rotate(${isOpen ? "90deg" : "0deg"})`,
                        }}
                      />
                    </button>
                  </div>
                </div>
                <div>
                  {isOpen && (
                    <Code
                      language="sql"
                      code={identityJoin.query}
                      containerClassName="mb-0"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : userIdTypes.length >= 2 ? (
        // Empty state
        <div className="alert alert-info">No identity joins.</div>
      ) : null}

      {/* endregion Identity Joins list */}

      {/* region Add/Edit modal */}
      {uiMode === "edit" || uiMode === "add" ? (
        <AddEditIdentityJoinModal
          dataSource={dataSource}
          mode={uiMode}
          onSave={handleSave(editingIndex)}
          onCancel={handleCancel}
          identityJoin={identityJoins[editingIndex]}
        />
      ) : null}
      {/* endregion Add/Edit modal */}
    </div>
  );
};
