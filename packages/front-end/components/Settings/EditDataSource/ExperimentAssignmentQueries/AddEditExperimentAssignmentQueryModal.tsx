import React, { FC, useMemo, useState } from "react";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "back-end/types/datasource";
import { useForm } from "react-hook-form";
import cloneDeep from "lodash/cloneDeep";
import uniqId from "uniqid";
import { FaExclamationTriangle, FaExternalLinkAlt } from "react-icons/fa";
import { TestQueryRow } from "back-end/src/types/Integration";
import Code from "@/components/SyntaxHighlighting/Code";
import StringArrayField from "@/components/Forms/StringArrayField";
import Toggle from "@/components/Forms/Toggle";
import Tooltip from "@/components/Tooltip/Tooltip";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import EditSqlModal from "@/components/SchemaBrowser/EditSqlModal";

type EditExperimentAssignmentQueryProps = {
  exposureQuery?: ExposureQuery;
  dataSource: DataSourceInterfaceWithParams;
  mode: "add" | "edit";
  onSave: (exposureQuery: ExposureQuery) => void;
  onCancel: () => void;
};

export const AddEditExperimentAssignmentQueryModal: FC<EditExperimentAssignmentQueryProps> = ({
  exposureQuery,
  dataSource,
  mode,
  onSave,
  onCancel,
}) => {
  const [showAdvancedMode, setShowAdvancedMode] = useState(false);
  const [uiMode, setUiMode] = useState<"view" | "sql" | "dimension">("view");
  const modalTitle =
    mode === "add"
      ? "添加一个实验分配查询"
      : `编辑${exposureQuery ? exposureQuery.name : "实验分配"}查询`;

  const userIdTypeOptions = dataSource?.settings?.userIdTypes?.map(
    ({ userIdType }) => ({
      display: userIdType,
      value: userIdType,
    })
  );
  const defaultUserId = userIdTypeOptions
    ? userIdTypeOptions[0]?.value
    : "user_id";

  const defaultQuery = `SELECT\n  ${defaultUserId} as ${defaultUserId},\n  timestamp as timestamp,\n  experiment_id as experiment_id,\n  variation_id as variation_id\nFROM my_table`;

  const form = useForm<ExposureQuery>({
    defaultValues:
      mode === "edit" && exposureQuery
        ? cloneDeep<ExposureQuery>(exposureQuery)
        : {
          description: "",
          id: uniqId("tbl_"),
          name: "",
          dimensions: [],
          query: defaultQuery,
          userIdType: userIdTypeOptions ? userIdTypeOptions[0]?.value : "",
        },
  });

  // User-entered values
  const userEnteredUserIdType = form.watch("userIdType");
  const userEnteredQuery = form.watch("query");
  const userEnteredDimensions = form.watch("dimensions");
  const userEnteredHasNameCol = form.watch("hasNameCol");

  const handleSubmit = form.handleSubmit(async (value) => {
    await onSave(value);

    form.reset({
      id: undefined,
      query: "",
      name: "",
      dimensions: [],
      description: "",
      hasNameCol: false,
      userIdType: undefined,
    });
  });

  const requiredColumns = useMemo(() => {
    return new Set([
      "experiment_id",
      "variation_id",
      "timestamp",
      userEnteredUserIdType,
      ...(userEnteredDimensions || []),
      ...(userEnteredHasNameCol ? ["experiment_name", "variation_name"] : []),
    ]);
  }, [userEnteredUserIdType, userEnteredDimensions, userEnteredHasNameCol]);

  const identityTypes = useMemo(() => dataSource.settings.userIdTypes || [], [
    dataSource.settings.userIdTypes,
  ]);

  const saveEnabled = !!userEnteredUserIdType && !!userEnteredQuery;

  if (!exposureQuery && mode === "edit") {
    console.error(
      "实现错误：编辑模式下需要曝光查询"
    );
    return null;
  }

  const validateResponse = (result: TestQueryRow) => {
    if (!result) return;

    const namedCols = ["experiment_name", "variation_name"];
    const userIdTypes = identityTypes?.map((type) => type.userIdType || []);

    const requiredColumnsArray = Array.from(requiredColumns);
    const returnedColumns = new Set<string>(Object.keys(result));
    const optionalColumns = [...returnedColumns].filter(
      (col) =>
        !requiredColumns.has(col) &&
        !namedCols.includes(col) &&
        !userIdTypes?.includes(col)
    );
    let missingColumns = requiredColumnsArray.filter((col) => !(col in result));

    // Check if `hasNameCol` should be enabled
    if (!userEnteredHasNameCol) {
      // Selected both required columns, turn on `hasNameCol` automatically
      if (
        returnedColumns.has("experiment_name") &&
        returnedColumns.has("variation_name")
      ) {
        form.setValue("hasNameCol", true);
      }
      // Only selected `experiment_name`, add warning
      else if (returnedColumns.has("experiment_name")) {
        throw new Error(
          "缺少“版本名称”列。请将其添加到您的SELECT子句中，以便CSII能够自动填充名称，或者移除“实验名称”。"
        );
      }
      // Only selected `variation_name`, add warning
      else if (returnedColumns.has("variation_name")) {
        throw new Error(
          "缺少“实验名称”列。请将其添加到您的SELECT子句中，以便CSII能够自动填充名称，或者移除“版本名称”。"
        );
      }
    } else {
      // `hasNameCol` is enabled, make sure both name columns are selected
      if (
        !returnedColumns.has("experiment_name") &&
        !returnedColumns.has("variation_name")
      ) {
        form.setValue("hasNameCol", false);
        missingColumns = missingColumns.filter(
          (column) =>
            column !== "experiment_name" && column !== "variation_name"
        );
      } else if (
        returnedColumns.has("experiment_name") &&
        !returnedColumns.has("variation_name")
      ) {
        throw new Error(
          "缺少“版本名称”列。请将其添加到您的SELECT子句中，以便CSII能够自动填充名称，或者移除“实验名称”。"
        );
      } else if (
        returnedColumns.has("variation_name") &&
        !returnedColumns.has("experiment_name")
      ) {
        throw new Error(
          "缺少“实验名称”列。请将其添加到您的SELECT子句中，以便CSII能够自动填充名称，或者移除“版本名称”。"
        );
      }
    }

    if (missingColumns.length > 0) {
      // Check if any of the missing columns are dimensions
      const missingDimensions = missingColumns.map((column) => {
        if (userEnteredDimensions.includes(column)) {
          return column;
        }
      });

      // If so, remove them from as a userEnteredDimension & remove from missingColumns
      if (missingDimensions.length > 0) {
        missingColumns = missingColumns.filter(
          (column) => !missingDimensions.includes(column)
        );

        const newUserEnteredDimensions = userEnteredDimensions.filter(
          (column) => !missingDimensions.includes(column)
        );
        form.setValue("dimensions", newUserEnteredDimensions);
      }

      // Now, if missingColumns still has a length, throw an error
      if (missingColumns.length > 0) {
        throw new Error(
          `你缺少以下列：${missingColumns.join(", ")}`
        );
      }
    }

    // Add optional columns as dimensions
    if (optionalColumns.length > 0) {
      {
        optionalColumns.forEach((col) => {
          form.setValue("dimensions", [...userEnteredDimensions, col]);
        });
      }
    }
  };

  return (
    <>
      {uiMode === "sql" && dataSource && (
        <EditSqlModal
          close={() => setUiMode("view")}
          datasourceId={dataSource.id || ""}
          requiredColumns={requiredColumns}
          value={userEnteredQuery}
          save={async (userEnteredQuery) => {
            form.setValue("query", userEnteredQuery);
          }}
          validateResponseOverride={validateResponse}
        />
      )}

      <Modal
        trackingEventModalType=""
        open={true}
        submit={handleSubmit}
        close={onCancel}
        size="lg"
        header={modalTitle}
        cta="保存"
        ctaEnabled={saveEnabled}
        autoFocusSelector="#id-modal-identify-joins-heading"
      >
        <div className="my-2 ml-3 mr-3">
          <div className="row">
            <div className="col-12">
              <Field label="显示名称" required {...form.register("name")} />
              <Field
                label="描述（可选）"
                textarea
                minRows={1}
                {...form.register("description")}
              />
              <Field
                label="分隔符类型"
                options={identityTypes.map((i) => i.userIdType)}
                required
                {...form.register("userIdType")}
              />
              <div className="form-group">
                <label className="mr-5">Query</label>
                {userEnteredQuery === defaultQuery && (
                  <div className="alert alert-info">
                    <FaExclamationTriangle style={{ marginTop: "-2px" }} /> 下面预先填充的查询可能需要进行编辑以适配您的数据结构。
                  </div>
                )}
                {userEnteredQuery && (
                  <Code
                    language="sql"
                    code={userEnteredQuery}
                    expandable={true}
                  />
                )}
                <div>
                  <button
                    className="btn btn-primary mt-2"
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setUiMode("sql");
                    }}
                  >
                    <div className="d-flex align-items-center">
                      自定义SQL
                      <FaExternalLinkAlt className="ml-2" />
                    </div>
                  </button>
                </div>
              </div>

              <div className="form-group">
                <a
                  href="#"
                  className="ml-auto"
                  style={{ fontSize: "0.9em" }}
                  onClick={(e) => {
                    e.preventDefault();
                    setShowAdvancedMode(!showAdvancedMode);
                  }}
                >
                  {showAdvancedMode ? "隐藏" : "显示"} 高级模式
                </a>
                {showAdvancedMode && (
                  <div>
                    <div>
                      <div className="mt-3 mb-3">
                        <Toggle
                          id="userEnteredNameCol"
                          value={form.watch("hasNameCol") || false}
                          setValue={(value) => {
                            form.setValue("hasNameCol", value);
                          }}
                        />
                        <label
                          className="mr-2 mb-0"
                          htmlFor="exposure-query-toggle"
                        >
                          使用名称列
                        </label>
                        <Tooltip body="如果您在表中同时存储实验 / 版本名称以及其对应的 ID，请启用此项。" />
                      </div>
                      <StringArrayField
                        label="维度列"
                        value={userEnteredDimensions}
                        onChange={(dimensions) => {
                          form.setValue("dimensions", dimensions);
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
};
