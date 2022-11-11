import React, { FC, ReactElement, useEffect, useMemo, useState } from "react";
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
import DisplayTestQueryResults from "../../DisplayTestQueryResults";
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
  sql?: string;
};

export const AddEditExperimentAssignmentQueryModal: FC<EditExperimentAssignmentQueryProps> = ({
  exposureQuery,
  dataSource,
  mode,
  onSave,
  onCancel,
}) => {
  const [
    testQueryResults,
    setTestQueryResults,
  ] = useState<TestQueryResults | null>(null);
  const [suggestions, setSuggestions] = useState<ReactElement[]>([]);
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

  const handleTestQuery = async () => {
    setTestQueryResults(null);
    try {
      validateSQL(userEnteredQuery, [...requiredColumns]);

      const res: TestQueryResults = await apiCall("/query/test", {
        method: "POST",
        body: JSON.stringify({
          query: userEnteredQuery,
          datasourceId: dataSource.id,
        }),
      });

      setTestQueryResults(res);
    } catch (e) {
      setTestQueryResults({ error: e.message });
    }
  };

  const identityTypes = useMemo(() => dataSource.settings.userIdTypes || [], [
    dataSource.settings.userIdTypes,
  ]);

  const saveEnabled = !!userEnteredUserIdType && !!userEnteredQuery;

  useEffect(() => {
    const result = testQueryResults?.results?.[0];
    if (!result) return;

    const suggestions: ReactElement[] = [];

    const namedCols = ["experiment_name", "variation_name"];
    const userIdTypes = identityTypes.map((type) => type.userIdType || []);

    const returnedColumns = new Set<string>(Object.keys(result));
    const optionalColumns = [...returnedColumns].filter(
      (col) =>
        !requiredColumns.has(col) &&
        !namedCols.includes(col) &&
        !userIdTypes.includes(col)
    );

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
        suggestions.push(
          <>
            Add <code>variation_name</code> to your SELECT clause to enable
            GrowthBook to populate names automatically.
          </>
        );
      }
      // Only selected `variation_name`, add warning
      else if (returnedColumns.has("variation_name")) {
        suggestions.push(
          <>
            Add <code>experiment_name</code> to your SELECT clause to enable
            GrowthBook to populate names automatically.
          </>
        );
      }
    }

    // Prompt to add optional columns as dimensions
    if (optionalColumns.length > 0) {
      suggestions.push(
        <>
          The following columns were returned, but will be ignored. Add them as
          dimensions or disregard this message.
          <ul className="mb-0 pb-0">
            {optionalColumns.map((col) => (
              <li key={col}>
                <code>{col}</code> -{" "}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    form.setValue("dimensions", [
                      ...userEnteredDimensions,
                      col,
                    ]);
                  }}
                >
                  add as dimension
                </a>
              </li>
            ))}
          </ul>
        </>
      );
    }

    setSuggestions(suggestions);
  }, [
    requiredColumns,
    testQueryResults,
    userEnteredDimensions,
    identityTypes,
    userEnteredHasNameCol,
    form,
  ]);

  if (!exposureQuery && mode === "edit") {
    console.error(
      "ImplementationError: exposureQuery is required for Edit mode"
    );
    return null;
  }

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
              <div className="col-lg-8 col-md-7">
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
                  {testQueryResults && (
                    <DisplayTestQueryResults
                      duration={parseInt(testQueryResults.duration || "0")}
                      requiredColumns={[...requiredColumns]}
                      result={testQueryResults.results?.[0]}
                      suggestions={suggestions}
                      error={testQueryResults.error}
                      sql={testQueryResults.sql}
                    />
                  )}
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
          </div>
        </div>
      </div>
    </Modal>
  );
};
