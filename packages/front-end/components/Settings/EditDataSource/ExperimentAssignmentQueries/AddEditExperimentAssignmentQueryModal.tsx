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
import Tooltip from "../../../Tooltip";
import Toggle from "../../../Forms/Toggle";
import StringArrayField from "../../../Forms/StringArrayField";
import { validateSQL } from "../../../../services/datasources";
import { useAuth } from "../../../../services/auth";

type EditExperimentAssignmentQueryProps = {
  exposureQuery?: ExposureQuery;
  dataSource: DataSourceInterfaceWithParams;
  mode: "add" | "edit";
  onSave: (exposureQuery: ExposureQuery) => void;
  onCancel: () => void;
};

type TestQueryResults = {
  status: number;
  errorMessage?: string;
};

export const AddEditExperimentAssignmentQueryModal: FC<
  EditExperimentAssignmentQueryProps
> = ({ exposureQuery, dataSource, mode, onSave, onCancel }) => {
  const [testQuerySuccessMessage, setTestQuerySuccessMessage] = useState("");
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
    const requiredColumns = [
      "experiment_id",
      "variation_id",
      "timestamp",
      value.userIdType,
      ...(value.dimensions || []),
      ...(value.hasNameCol ? ["experiment_name", "variation_name"] : []),
    ];
    validateSQL(value.query, requiredColumns);

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
    const options = {
      sql: userEnteredQuery,
      id: dataSource.id,
    };

    console.log("options", options);

    const res: TestQueryResults = await apiCall("/query/exposure/validity", {
      method: "POST",
      body: JSON.stringify(options),
    });

    if (res.status === 200 && !res.errorMessage) {
      setTestQuerySuccessMessage("Bravo - The test query ran successfully!");
    }

    //TODO: Add error handling in a way that works with the Modals built-in error handling

    console.log("res", res);
  };

  const testQueryButton = (
    <button
      className="btn btn-link"
      disabled={!saveEnabled}
      type="button"
      onClick={handleTestQuery}
    >
      Test Query
    </button>
  );

  return (
    <Modal
      open={true}
      submit={handleSubmit}
      close={onCancel}
      size="max"
      header={modalTitle}
      cta="Save"
      ctaEnabled={saveEnabled}
      secondaryCTA={testQueryButton}
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

            {testQuerySuccessMessage && (
              <div className="alert alert-success">
                {testQuerySuccessMessage}
              </div>
            )}
            <div className="row">
              <div className="col">
                <CodeTextArea
                  label="SQL Query"
                  required
                  language="sql"
                  value={userEnteredQuery}
                  setValue={(sql) => form.setValue("query", sql)}
                />
                <div className="form-group">
                  <label className="mr-2">
                    Use Name Columns
                    <Tooltip body="Enable this if you store experiment/variation names as well as ids in your table" />
                  </label>
                  <Toggle
                    id="exposure-query-toggle"
                    value={userEnteredHasNameCol}
                    setValue={(hasNameCol) => {
                      form.setValue("hasNameCol", hasNameCol);
                    }}
                  />
                </div>

                <StringArrayField
                  label="Dimension Columns"
                  value={userEnteredDimensions}
                  onChange={(dimensions) => {
                    form.setValue("dimensions", dimensions);
                  }}
                />
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
