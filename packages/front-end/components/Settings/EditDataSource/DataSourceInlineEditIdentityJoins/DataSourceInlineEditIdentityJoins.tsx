import React, { FC, useCallback, useState } from "react";
import { DataSourceQueryEditingModalBaseProps } from "../types";
import { EmptyStateCard } from "../EmptyStateCard";
import { FaChevronRight, FaPlus } from "react-icons/fa";
import Code from "../../../Code";

type DataSourceInlineEditIdentityJoinsProps = DataSourceQueryEditingModalBaseProps;

export const DataSourceInlineEditIdentityJoins: FC<DataSourceInlineEditIdentityJoinsProps> = ({
  dataSource,
  onSave,
  onCancel,
}) => {
  const [uiMode, setUiMode] = useState<"view" | "edit" | "add">("view");
  const [editingIndex, setEditingIndex] = useState<number>(-1);

  const [openIndexes, setOpenIndexes] = useState<boolean[]>([]);

  const handleExpandCollapseForIndex = useCallback(
    (index) => () => {
      const currentValue = openIndexes[index] || false;
      const updatedOpenIndexes = [...openIndexes];
      updatedOpenIndexes[index] = !currentValue;

      setOpenIndexes(updatedOpenIndexes);
    },
    [openIndexes]
  );

  // const indexOpenMapRef = useRef<Map<number, boolean>>(new Map());

  const addIsDisabled = (dataSource.settings?.userIdTypes || []).length < 2;

  const identityJoins = dataSource?.settings?.queries?.identityJoins || [];

  const handleAdd = useCallback(() => {
    setUiMode("add");
    setEditingIndex(identityJoins.length);
  }, [identityJoins]);

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

        <div className="">
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
                <h4 className="py-3 px-3 my-0">
                  {identityJoin.ids.join(" ↔ ")}
                </h4>
                <button
                  className="btn"
                  onClick={handleExpandCollapseForIndex(idx)}
                >
                  <FaChevronRight
                    style={{
                      transform: `rotate(${isOpen ? "90deg" : "0deg"})`,
                    }}
                  />
                </button>
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
            <p>No identity joins.</p>
            {addIsDisabled && (
              <p>
                You will be able to create identifier join tables when you have
                identified at least 2 user identifiers.
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
    </div>
  );
};
