import React, { FC, Fragment, useCallback, useMemo, useState } from "react";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "back-end/types/datasource";
import cloneDeep from "lodash/cloneDeep";
import { FaChevronRight, FaPencilAlt, FaPlus } from "react-icons/fa";
import { useRouter } from "next/router";
import { checkDatasourceProjectPermissions } from "@/services/datasources";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import usePermissions from "@/hooks/usePermissions";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Code from "@/components/SyntaxHighlighting/Code";
import { AddEditExperimentAssignmentQueryModal } from "@/components/Settings/EditDataSource/ExperimentAssignmentQueries/AddEditExperimentAssignmentQueryModal";
import MoreMenu from "@/components/Dropdown/MoreMenu";

type ExperimentAssignmentQueriesProps = DataSourceQueryEditingModalBaseProps;

export const ExperimentAssignmentQueries: FC<ExperimentAssignmentQueriesProps> = ({
  dataSource,
  onSave,
  onCancel,
  canEdit = true,
}) => {
  const router = useRouter();
  let intitialOpenIndexes: boolean[] = [];
  if (router.query.openAll === "1") {
    intitialOpenIndexes = Array.from(
      Array(dataSource.settings?.queries?.exposure?.length || 0)
    ).fill(true);
  }

  const [uiMode, setUiMode] = useState<"view" | "edit" | "add">("view");
  const [editingIndex, setEditingIndex] = useState<number>(-1);
  const [openIndexes, setOpenIndexes] = useState<boolean[]>(
    intitialOpenIndexes
  );

  const permissions = usePermissions();
  canEdit =
    canEdit &&
    checkDatasourceProjectPermissions(
      dataSource,
      permissions,
      "editDatasourceSettings"
    );

  const handleExpandCollapseForIndex = useCallback(
    (index) => () => {
      const currentValue = openIndexes[index] || false;
      const updatedOpenIndexes = [...openIndexes];
      updatedOpenIndexes[index] = !currentValue;

      setOpenIndexes(updatedOpenIndexes);
    },
    [openIndexes]
  );

  const handleCancel = useCallback(() => {
    setUiMode("view");
    setEditingIndex(-1);
    onCancel();
  }, [onCancel]);

  const experimentExposureQueries = useMemo(
    () => dataSource.settings?.queries.exposure || [],
    [dataSource.settings?.queries.exposure]
  );

  const handleAdd = useCallback(() => {
    setUiMode("add");
    setEditingIndex(experimentExposureQueries.length);
  }, [experimentExposureQueries]);

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

      copy.settings.queries.exposure.splice(idx, 1);

      await onSave(copy);
    },
    [onSave, dataSource]
  );

  const handleSave = useCallback(
    (idx: number) => async (exposureQuery: ExposureQuery) => {
      const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
      copy.settings.queries.exposure[idx] = exposureQuery;
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
        <div className="">
          <h3>Experiment Assignment Queries</h3>
          <p>
            Queries that return a list of experiment variation assignment
            events. Returns a record of which experiment variation was assigned
            to each user.
          </p>
        </div>

        {canEdit && (
          <div className="">
            <button
              className="btn btn-outline-primary font-weight-bold text-nowrap"
              onClick={handleAdd}
            >
              <FaPlus className="mr-1" /> Add
            </button>
          </div>
        )}
      </div>

      {/* region Empty state */}
      {experimentExposureQueries.length === 0 ? (
        <div className="alert alert-info mb-0">
          No experiment assignment queries
        </div>
      ) : null}
      {/* endregion Empty state */}

      {experimentExposureQueries.map((query, idx) => {
        const isOpen = openIndexes[idx] || false;

        return (
          <div key={query.id} className="card p-3 mb-3">
            <div className="d-flex justify-content-between">
              {/* region Title Bar */}
              <div>
                <div className="d-flex">
                  <h4>{query.name}</h4>
                  {query.description && (
                    <p className="ml-3 text-muted">{query.description}</p>
                  )}
                </div>

                <div className="row">
                  <div className="col-auto">
                    <strong>Identifier: </strong>
                    <code>{query.userIdType}</code>
                  </div>
                  <div className="col-auto">
                    <strong>Dimension Columns: </strong>
                    {query.dimensions.map((d, i) => (
                      <Fragment key={i}>
                        {i ? ", " : ""}
                        <code key={d}>{d}</code>
                      </Fragment>
                    ))}
                    {!query.dimensions.length && (
                      <em className="text-muted">none</em>
                    )}
                  </div>
                </div>
              </div>

              {/* endregion Title Bar */}

              {/* region Actions*/}

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
                      displayName={query.name}
                      deleteMessage={`Are you sure you want to delete identifier join ${query.name}?`}
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

              {/* endregion Actions*/}
            </div>

            {isOpen && (
              <div className="mb-2">
                <Code
                  language="sql"
                  code={query.query}
                  containerClassName="mb-0"
                />
              </div>
            )}
          </div>
        );
      })}

      {/* region Add/Edit modal */}

      {uiMode === "edit" || uiMode === "add" ? (
        <AddEditExperimentAssignmentQueryModal
          exposureQuery={experimentExposureQueries[editingIndex]}
          dataSource={dataSource}
          mode={uiMode}
          onSave={handleSave(editingIndex)}
          onCancel={handleCancel}
        />
      ) : null}

      {/* endregion Add/Edit modal */}
    </div>
  );
};
