import React, { FC, useCallback, useState } from "react";
import { DataSourceQueryEditingModalBaseProps } from "../types";
import { EmptyStateCard } from "../EmptyStateCard";
import { FaChevronRight, FaPencilAlt, FaPlus } from "react-icons/fa";
import Code from "../../../Code";
import MoreMenu from "../../../Dropdown/MoreMenu";
import DeleteButton from "../../../DeleteButton";
import cloneDeep from "lodash/cloneDeep";
import {
  DataSourceInterfaceWithParams,
  IdentityJoinQuery,
} from "back-end/types/datasource";
import { AddEditIdentityJoinModal } from "./AddEditIdentityJoinModal";

type DataSourceInlineEditIdentityJoinsProps = DataSourceQueryEditingModalBaseProps;

export const DataSourceInlineEditIdentityJoins: FC<DataSourceInlineEditIdentityJoinsProps> = ({
  dataSource,
  onSave,
  onCancel,
}) => {
  const [uiMode, setUiMode] = useState<"view" | "edit" | "add">("view");
  const [editingIndex, setEditingIndex] = useState<number>(-1);

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

  const addIsDisabled = (dataSource.settings?.userIdTypes || []).length < 2;

  const identityJoins = dataSource?.settings?.queries?.identityJoins || [];

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

      onSave(copy);
    },
    [identityJoins, onSave, dataSource]
  );

  const handleSave = useCallback(
    (idx: number) => (identityJoin: IdentityJoinQuery) => {
      const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
      copy.settings.queries.identityJoins[idx] = identityJoin;
      onSave(copy);
    },
    [dataSource, onSave, uiMode]
  );

  if (!dataSource) {
    console.error("ImplementationError: dataSource cannot be null");
    return null;
  }

  return (
    <div className="my-5">
      {/* region Heading */}
      <div className="d-flex justify-content-between align-items-center">
        <div className="">
          <h3>Identifier Join Tables</h3>
          <p>
            Joins different identifier types together when needed during
            experiment analysis.
          </p>
          {addIsDisabled && (
            <p>
              You will be able to create identifier join tables when you have
              identified at least 2 user identifiers.
            </p>
          )}
        </div>

        <div>
          <button
            disabled={addIsDisabled}
            className="btn btn-outline-primary font-weight-bold"
            onClick={handleAdd}
          >
            <FaPlus className="mr-1" /> Add
          </button>
        </div>
      </div>
      {/* endregion Heading */}

      {/* region Identity Joins list */}
      <div className="mb-4">
        {identityJoins.map((identityJoin, idx) => {
          const isOpen = openIndexes[idx] || false;
          return (
            <div className="bg-white border mb-3" key={`identity-join-${idx}`}>
              <div className="d-flex justify-content-between">
                {/* Title */}
                <h4 className="py-3 px-3 my-0">
                  {identityJoin.ids.join(" ↔ ")}
                </h4>

                {/* Actions*/}
                <div className="d-flex align-items-center">
                  <MoreMenu id="DataSourceInlineEditIdentifierTypes_identifier-joins">
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

                  <button
                    className="btn ml-3"
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
                    theme="light"
                    code={identityJoin.query}
                    containerClassName="mb-0"
                    expandable={true}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      {/* endregion Identity Joins list */}

      {/* region Identity Joins empty state */}
      {identityJoins.length === 0 ? (
        <EmptyStateCard>
          <div className="mb-3">
            <h4>No identity joins.</h4>
            {addIsDisabled ? (
              <p>
                You will be able to create identifier join tables when you have
                identified at least 2 user identifiers.
              </p>
            ) : (
              <p>
                You can create identifier join tables with 2 or more identifiers
              </p>
            )}
          </div>

          <button
            disabled={addIsDisabled}
            onClick={handleAdd}
            className="btn btn-outline-primary font-weight-bold"
          >
            <FaPlus className="mr-1" /> Add
          </button>
        </EmptyStateCard>
      ) : null}
      {/* endregion Identity Joins empty state */}

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
