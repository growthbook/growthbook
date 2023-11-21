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
import Button from "@/components/Button";
import {
  UpdateReliableDimensions,
  UpdateReliableDimensionsModal,
} from "../ReliableDimension/UpdateReliableDimensions";

type ExperimentAssignmentQueriesProps = DataSourceQueryEditingModalBaseProps;
type UIMode = "view" | "edit" | "add" | "dimension";
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

  const [uiMode, setUiMode] = useState<UIMode>("view");
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
    // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
    () => dataSource.settings?.queries.exposure || [],
    // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
    [dataSource.settings?.queries.exposure]
  );

  const handleAdd = useCallback(() => {
    setUiMode("add");
    setEditingIndex(experimentExposureQueries.length);
  }, [experimentExposureQueries]);

  const handleActionClicked = useCallback(
    (idx: number, uiMode: UIMode) => async () => {
      setEditingIndex(idx);
      setUiMode(uiMode);
    },
    []
  );

  const handleActionDeleteClicked = useCallback(
    (idx: number) => async () => {
      const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);

      // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      copy.settings.queries.exposure.splice(idx, 1);

      await onSave(copy);
    },
    [onSave, dataSource]
  );

  const handleSave = useCallback(
    (idx: number) => async (exposureQuery: ExposureQuery) => {
      const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
      // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      copy.settings.queries.exposure[idx] = exposureQuery;
      await onSave(copy);
    },
    [dataSource, onSave]
  );

  const [validatingQuery, setValidatingQuery] = useState(false);

  const handleValidate = useCallback(
    () => async () => {
      const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
      setValidatingQuery(true);
      // Resaving the document as-is will automatically revalidate any queries in error state
      await onSave(copy);
      setValidatingQuery(false);
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
          <div key={query.id} className="card p-3 mb-3 bg-light">
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
                  <div className="col-auto">
                    <Button onClick={handleActionClicked(idx, "dimension")}>
                      Update Dimension Slices
                    </Button>
                  </div>
                </div>
                {query.error && (
                  <div
                    className="alert alert-danger"
                    style={{ marginTop: "1rem" }}
                  >
                    This query had an error with it the last time it ran:{" "}
                    <div className="font-weight-bold">{query.error}</div>
                    <div style={{ marginTop: "1rem" }}>
                      <Button
                        onClick={handleValidate()}
                        loading={validatingQuery}
                      >
                        Check it again.
                      </Button>
                      {canEdit && (
                        <Button
                          onClick={handleActionClicked(idx, "edit")}
                          style={{ marginLeft: "1rem" }}
                        >
                          Edit it now.
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* endregion Title Bar */}

              {/* region Actions*/}

              <div
                className="d-flex align-items-center"
                style={{ height: "fit-content" }}
              >
                {canEdit && (
                  <MoreMenu>
                    <button
                      className="dropdown-item py-2"
                      onClick={handleActionClicked(idx, "edit")}
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

      {uiMode === "dimension" ? (
        <UpdateReliableDimensionsModal
          exposureQuery={experimentExposureQueries[editingIndex]}
          dataSource={dataSource}
          close={() => setUiMode("view")}
          onSave={handleSave(editingIndex)}
        />
      ) : null}

      {/* endregion Add/Edit modal */}
    </div>
  );
};
