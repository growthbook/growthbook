import React, { FC, Fragment, useCallback, useMemo, useState } from "react";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "back-end/types/datasource";
import cloneDeep from "lodash/cloneDeep";
import { FaChevronRight, FaPencilAlt, FaPlus } from "react-icons/fa";
import { useRouter } from "next/router";
import { BsGear } from "react-icons/bs";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Code from "@/components/SyntaxHighlighting/Code";
import { AddEditExperimentAssignmentQueryModal } from "@/components/Settings/EditDataSource/ExperimentAssignmentQueries/AddEditExperimentAssignmentQueryModal";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import Button from "@/components/Button";
import { UpdateDimensionMetadataModal } from "@/components/Settings/EditDataSource/DimensionMetadata/UpdateDimensionMetadata";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

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

  const permissionsUtil = usePermissionsUtil();
  canEdit = canEdit && permissionsUtil.canUpdateDataSourceSettings(dataSource);

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
    () => dataSource.settings?.queries?.exposure || [],
    [dataSource.settings?.queries?.exposure]
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
    console.error("实现错误：数据源不能为空");
    return null;
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div className="">
          <h3>实验分配查询</h3>
          <p>
            这些查询会返回实验版本分配事件的列表。它会返回每个用户被分配到哪个实验版本的记录。
          </p>
        </div>

        {canEdit && (
          <div className="">
            <button
              className="btn btn-outline-primary font-weight-bold text-nowrap"
              onClick={handleAdd}
            >
              <FaPlus className="mr-1" /> 添加
            </button>
          </div>
        )}
      </div>

      {/* region Empty state */}
      {experimentExposureQueries.length === 0 ? (
        <div className="alert alert-info mb-0">
          没有实验分配查询。
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
                    <strong>分隔符：</strong>
                    <code>{query.userIdType}</code>
                  </div>
                  <div className="col-auto">
                    <strong>维度列：</strong>
                    {query.dimensions.map((d, i) => (
                      <Fragment key={i}>
                        {i ? ", " : ""}
                        <code key={d}>{d}</code>
                      </Fragment>
                    ))}
                    {!query.dimensions.length && (
                      <em className="text-muted">无</em>
                    )}
                  </div>
                </div>
                {query.error && (
                  <div
                    className="alert alert-danger"
                    style={{ marginTop: "1rem" }}
                  >
                    上次运行此查询时出现了错误：
                    <div className="font-weight-bold">{query.error}</div>
                    <div style={{ marginTop: "1rem" }}>
                      <Button
                        onClick={handleValidate()}
                        loading={validatingQuery}
                      >
                        重试
                      </Button>
                      {canEdit && (
                        <Button
                          onClick={handleActionClicked(idx, "edit")}
                          style={{ marginLeft: "1rem" }}
                        >
                          立即编辑。
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
                      <FaPencilAlt className="mr-2" /> 编辑查询
                    </button>
                    {query.dimensions.length > 0 ? (
                      <button
                        className="dropdown-item py-2"
                        onClick={handleActionClicked(idx, "dimension")}
                      >
                        <BsGear className="mr-2" /> 配置维度
                      </button>
                    ) : null}

                    <DeleteButton
                      onClick={handleActionDeleteClicked(idx)}
                      className="dropdown-item text-danger py-2"
                      iconClassName="mr-2"
                      style={{ borderRadius: 0 }}
                      useIcon
                      displayName={query.name}
                      deleteMessage={`Are you sure you want to delete identifier join ${query.name}?`}
                      title="删除"
                      text="删除"
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
        <UpdateDimensionMetadataModal
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
