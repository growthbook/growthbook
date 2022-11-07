import React, { FC, useState } from "react";
import Modal from "../../../Modal";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "back-end/types/datasource";
import { useForm } from "react-hook-form";
import cloneDeep from "lodash/cloneDeep";
import uniqId from "uniqid";
import Field from "../../../Forms/Field";
import CodeTextArea from "../../../Forms/CodeTextArea";
import Tooltip from "../../../Tooltip/Tooltip";
import StringArrayField from "../../../Forms/StringArrayField";
import { validateSQL } from "../../../../services/datasources";
import { useAuth } from "../../../../services/auth";
import { FaPlay } from "react-icons/fa";
import DisplayTestQueryResults, {
  Results,
} from "../../DisplayTestQueryResults";
import { TestQueryRow } from "back-end/src/types/Integration";

type EditExperimentAssignmentQueryProps = {
  exposureQuery?: ExposureQuery;
  dataSource: DataSourceInterfaceWithParams;
  mode: "add" | "edit";
  onSave: (exposureQuery: ExposureQuery) => void;
  onCancel: () => void;
};

type TestQueryResults = {
  duration?: string;
  error?: string;
  results?: TestQueryRow[];
};

export const AddEditExperimentAssignmentQueryModal: FC<EditExperimentAssignmentQueryProps> = ({
  exposureQuery,
  dataSource,
  mode,
  onSave,
  onCancel,
}) => {
  const [testQueryResults, setTestQueryResults] = useState<Results | null>(
    null
  );
  const { apiCall } = useAuth();
  const modalTitle =
    mode === "add"
      ? "Add an Experiment Assignment query"
      : `Edit ${exposureQuery.name}`;

  const userIdTypeOptions = dataSource.settings.userIdTypes.map(
    ({ userIdType }) => ({
      display: userIdType,
      value: userIdType,
    })
  );
  const defaultUserId = userIdTypeOptions[0]?.value || "user_id";

  const form = useForm<ExposureQuery>({
    defaultValues:
      mode === "edit"
        ? cloneDeep<ExposureQuery>(exposureQuery)
        : {
            description: "",
            id: uniqId("tbl_"),
            name: "",
            dimensions: [],
            query: `SELECT\n  ${defaultUserId} as ${defaultUserId},\n  timestamp as timestamp,\n  experiment_id as experiment_id,\n  variation_id as variation_id\nFROM my_table`,
            userIdType: userIdTypeOptions[0]?.value || "",
          },
  });

  // User-entered values
  const userEnteredUserIdType = form.watch("userIdType");
  const userEnteredQuery = form.watch("query");
  const userEnteredHasNameCol = form.watch("hasNameCol");
  const userEnteredDimensions = form.watch("dimensions");

  const getRequiredColumns = (userIdType, dimensions, hasNameCol) => {
    return [
      "experiment_id",
      "variation_id",
      "timestamp",
      userIdType,
      ...(dimensions || []),
      ...(hasNameCol ? ["experiment_name", "variation_name"] : []),
    ];
  };

  const handleSubmit = form.handleSubmit(async (value) => {
    await onSave(value);

    form.reset({
      id: null,
      query: "",
      name: "",
      dimensions: [],
      description: "",
      hasNameCol: false,
      userIdType: null,
    });
  });

  const identityTypes = dataSource.settings.userIdTypes || [];

  const saveEnabled = !!userEnteredUserIdType && !!userEnteredQuery;

  if (!exposureQuery && mode === "edit") {
    console.error(
      "ImplementationError: exposureQuery is required for Edit mode"
    );
    return null;
  }

  const handleTestQuery = async () => {
    setTestQueryResults(null);

    try {
      const requiredColumns = getRequiredColumns(
        userEnteredUserIdType,
        userEnteredDimensions,
        userEnteredHasNameCol
      );
      validateSQL(userEnteredQuery, requiredColumns);

      const res: TestQueryResults = await apiCall("/query/test", {
        method: "POST",
        body: JSON.stringify({
          query: userEnteredQuery,
          datasourceId: dataSource.id,
        }),
      });

      if (res.error) {
        setTestQueryResults({ error: res.error });
        return;
      }

      const warningsArr = [];
      const optionalColumns = [];
      const returnedColumns = [];
      const namedCols = ["experiment_name", "variation_name"];
      const userIdTypes = dataSource.settings.userIdTypes?.map(
        (type) => type.userIdType || []
      );

      if (res.results.length > 0) {
        for (const column in res.results[0]) {
          if (
            !requiredColumns.includes(column) &&
            !namedCols.includes(column) &&
            !userIdTypes.includes(column)
          ) {
            optionalColumns.push(column);
          }

          returnedColumns.push(column);
        }

        // If the user didn't check the box for includesNameColumns, but included
        // both, auto-enable it for them
        if (
          returnedColumns.includes("experiment_name") &&
          returnedColumns.includes("variation_name")
        ) {
          form.setValue("hasNameCol", true);
        }
      }

      // If the user enters 1 name column, but not both,
      // warn them they need to add both.
      if (
        !userEnteredHasNameCol &&
        returnedColumns.includes("variation_name") !==
          returnedColumns.includes("experiment_name")
      ) {
        if (!returnedColumns.includes("variation_name")) {
          warningsArr.push({
            type: "missingNameColumn",
            message:
              "If you want to use name columns, your query needs to include variation_name.",
          });
        } else {
          warningsArr.push({
            type: "missingNameColumn",
            message:
              "If you want to use name columns, your query needs to include experiment_name",
          });
        }
      }

      // Serve warning if optional columns are included
      if (optionalColumns?.length > 0) {
        const showPlural = optionalColumns.length > 1;
        const message = `The query entered includes ${
          showPlural ? "" : "an"
        } optional column${showPlural ? "s" : ""}: ${optionalColumns
          .map((col) => '"' + col + '"')
          .join(", ")}. Add ${
          showPlural ? "these as" : "this as a"
        } dimension column${
          showPlural ? "s" : ""
        } to drill down into experiment results. Or, remove ${
          showPlural ? "them" : "it"
        } to improve performance.`;
        warningsArr.push({
          type: "optionalColumns",
          message,
          optionalColumns: optionalColumns,
        });
      }

      if (res.duration && res.results.length === 0) {
        warningsArr.push({
          type: "noRowsReturned",
          message: "The query did not return any rows.",
        });
      }

      setTestQueryResults({
        success:
          res.duration &&
          res.results.length > 0 &&
          `The query ran successfully in ${res.duration} ms.`,
        warnings: warningsArr,
      });
    } catch (e) {
      setTestQueryResults({ error: e.message });
    }
  };

  return (
    <Modal
      open={true}
      submit={handleSubmit}
      close={onCancel}
      size="max"
      header={modalTitle}
      cta="Save"
      ctaEnabled={saveEnabled}
      autoFocusSelector="#id-modal-identify-joins-heading"
    >
      <div className="my-2 ml-3">
        <div className="row">
          <div className="col-xs-12">
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
            <StringArrayField
              label="Dimension Columns"
              value={userEnteredDimensions}
              onChange={(dimensions) => {
                form.setValue("dimensions", dimensions);
              }}
            />
            <div className="row">
              <div className="col">
                <label className="font-weight-bold mb-1">SQL Query</label>
                <div>
                  <div className="d-flex justify-content-between align-items-center p-1 border rounded">
                    <button
                      className="btn btn-sm btn-primary m-1"
                      onClick={(e) => {
                        e.preventDefault();
                        handleTestQuery();
                      }}
                    >
                      <span className="pr-2">
                        <FaPlay />
                      </span>
                      Test Query
                    </button>
                    <div className="d-flex m-1">
                      <label
                        className="mr-2 mb-0"
                        htmlFor="exposure-query-toggle"
                      >
                        Use Name Columns
                      </label>
                      <input
                        type="checkbox"
                        id="exposure-query-toggle"
                        className="form-check-input "
                        {...form.register("hasNameCol")}
                      />
                      <Tooltip body="Enable this if you store experiment/variation names as well as ids in your table" />
                    </div>
                  </div>
                  <CodeTextArea
                    required
                    language="sql"
                    value={userEnteredQuery}
                    setValue={(sql) => form.setValue("query", sql)}
                  />
                </div>
              </div>
              <div className="col-md-5 col-lg-4">
                <div className="pt-md-4">
                  <strong>Required columns</strong>
                </div>
                <ul>
                  <li>
                    <code>{userEnteredUserIdType}</code>
                  </li>
                  <li>
                    <code>timestamp</code>
                  </li>
                  <li>
                    <code>experiment_id</code>
                  </li>
                  <li>
                    <code>variation_id</code>
                  </li>
                  {userEnteredHasNameCol && (
                    <>
                      <li>
                        <code>experiment_name</code>
                      </li>
                      <li>
                        <code>variation_name</code>
                      </li>
                    </>
                  )}
                  {userEnteredDimensions &&
                    userEnteredDimensions.map((dimension) => {
                      return (
                        <li key={dimension}>
                          <code>{dimension}</code>
                        </li>
                      );
                    })}
                </ul>
                <div>
                  Any additional columns you select can be listed as dimensions
                  to drill down into experiment results.
                </div>
              </div>
            </div>
            <DisplayTestQueryResults results={testQueryResults} form={form} />
          </div>
        </div>
      </div>
    </Modal>
  );
};
