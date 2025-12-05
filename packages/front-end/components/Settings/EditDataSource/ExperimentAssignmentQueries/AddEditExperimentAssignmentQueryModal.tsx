import React, { FC, useMemo, useState } from "react";
import { Flex } from "@radix-ui/themes";
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
import Tooltip from "@/components/Tooltip/Tooltip";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import EditSqlModal from "@/components/SchemaBrowser/EditSqlModal";
import Checkbox from "@/ui/Checkbox";

type EditExperimentAssignmentQueryProps = {
  exposureQuery?: ExposureQuery;
  dataSource: DataSourceInterfaceWithParams;
  mode: "add" | "edit";
  onSave: (exposureQuery: ExposureQuery) => void;
  onCancel: () => void;
};

export const AddEditExperimentAssignmentQueryModal: FC<
  EditExperimentAssignmentQueryProps
> = ({ exposureQuery, dataSource, mode, onSave, onCancel }) => {
  const [showAdvancedMode, setShowAdvancedMode] = useState(false);
  const [uiMode, setUiMode] = useState<"view" | "sql" | "dimension">("view");
  const modalTitle =
    mode === "add"
      ? "Add an Experiment Assignment query"
      : `Edit ${
          exposureQuery ? exposureQuery.name : "Experiment Assignment"
        } query`;

  const userIdTypeOptions = dataSource?.settings?.userIdTypes?.map(
    ({ userIdType }) => ({
      display: userIdType,
      value: userIdType,
    }),
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

  const identityTypes = useMemo(
    () => dataSource.settings.userIdTypes || [],
    [dataSource.settings.userIdTypes],
  );

  const saveEnabled = !!userEnteredUserIdType && !!userEnteredQuery;

  if (!exposureQuery && mode === "edit") {
    console.error(
      "ImplementationError: exposureQuery is required for Edit mode",
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
        !userIdTypes?.includes(col),
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
          "Missing variation_name column. Please add it to your SELECT clause to enable GrowthBook to populate names automatically or remove experiment_name.",
        );
      }
      // Only selected `variation_name`, add warning
      else if (returnedColumns.has("variation_name")) {
        throw new Error(
          "Missing experiment_name column. Please add it to your SELECT clause to enable GrowthBook to populate names automatically or remove variation_name.",
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
            column !== "experiment_name" && column !== "variation_name",
        );
      } else if (
        returnedColumns.has("experiment_name") &&
        !returnedColumns.has("variation_name")
      ) {
        throw new Error(
          "Missing variation_name column. Please add it to your SELECT clause to enable GrowthBook to populate names automatically or remove experiment_name.",
        );
      } else if (
        returnedColumns.has("variation_name") &&
        !returnedColumns.has("experiment_name")
      ) {
        throw new Error(
          "Missing experiment_name column. Please add it to your SELECT clause to enable GrowthBook to populate names automatically or remove variation_name.",
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
          (column) => !missingDimensions.includes(column),
        );

        const newUserEnteredDimensions = userEnteredDimensions.filter(
          (column) => !missingDimensions.includes(column),
        );
        form.setValue("dimensions", newUserEnteredDimensions);
      }

      // Now, if missingColumns still has a length, throw an error
      if (missingColumns.length > 0) {
        throw new Error(
          `You are missing the following columns: ${missingColumns.join(", ")}`,
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
          sqlObjectInfo={{
            objectType: "Experiment Assignment Query",
            objectName: form.watch("name"),
          }}
        />
      )}

      <Modal
        trackingEventModalType=""
        open={true}
        submit={handleSubmit}
        close={onCancel}
        size="lg"
        header={modalTitle}
        cta="Save"
        ctaEnabled={saveEnabled}
        autoFocusSelector="#id-modal-identify-joins-heading"
      >
        <div className="my-2 ml-3 mr-3">
          <div className="row">
            <div className="col-12">
              <Field label="Display Name" required {...form.register("name")} />
              <Field
                label="Description (optional)"
                textarea
                minRows={1}
                {...form.register("description")}
              />
              <Field
                label="Identifier Type"
                options={identityTypes.map((i) => i.userIdType)}
                required
                {...form.register("userIdType")}
              />
              <div className="form-group">
                <label className="mr-5">Query</label>
                {userEnteredQuery === defaultQuery && (
                  <div className="alert alert-info">
                    <FaExclamationTriangle style={{ marginTop: "-2px" }} /> The
                    prefilled query below may require editing to fit your data
                    structure.
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
                      Customize SQL
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
                  {showAdvancedMode ? "Hide" : "Show"} Advanced Options
                </a>
                {showAdvancedMode && (
                  <div>
                    <div>
                      <Flex gap="1" my="3">
                        <Checkbox
                          id="userEnteredNameCol"
                          label="Use Name columns"
                          value={form.watch("hasNameCol") || false}
                          setValue={(value) => {
                            form.setValue("hasNameCol", value);
                          }}
                        />
                        <Tooltip body="Enable this if you store experiment/variation names as well as ids in your table" />
                      </Flex>
                      <StringArrayField
                        label="Dimension Columns"
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
