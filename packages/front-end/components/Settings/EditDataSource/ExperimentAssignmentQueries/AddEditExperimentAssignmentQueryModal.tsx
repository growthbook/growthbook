import React, { FC, useMemo, useState } from "react";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "back-end/types/datasource";
import { useForm } from "react-hook-form";
import cloneDeep from "lodash/cloneDeep";
import uniqId from "uniqid";
import { FaExternalLinkAlt } from "react-icons/fa";
import Code from "@/components/SyntaxHighlighting/Code";
import EditSqlModal from "@/components/SchemaBrowser/EditSqlModal";
import SQLInputField from "../../../SQLInputField";
import Modal from "../../../Modal";
import Field from "../../../Forms/Field";
import StringArrayField from "../../../Forms/StringArrayField";

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
  const [sqlOpen, setSqlOpen] = useState(false);
  const modalTitle =
    mode === "add"
      ? "Add an Experiment Assignment query"
      : `Edit ${exposureQuery.name}`;
  const supportsSchemaBrowser = dataSource.properties.supportsInformationSchema;

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

  const identityTypes = useMemo(() => dataSource.settings.userIdTypes || [], [
    dataSource.settings.userIdTypes,
  ]);

  const saveEnabled = !!userEnteredUserIdType && !!userEnteredQuery;

  if (!exposureQuery && mode === "edit") {
    console.error(
      "ImplementationError: exposureQuery is required for Edit mode"
    );
    return null;
  }

  return (
    <>
      {sqlOpen && dataSource && (
        <EditSqlModal
          close={() => setSqlOpen(false)}
          datasourceId={dataSource.id || ""}
          placeholder=""
          requiredColumns={Array.from(requiredColumns)}
          value={userEnteredQuery}
          save={async (sql) => form.setValue("query", sql)}
        />
      )}
      <Modal
        open={true}
        submit={handleSubmit}
        close={onCancel}
        size={supportsSchemaBrowser ? "md" : "max"}
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
              <StringArrayField
                label="Dimension Columns"
                value={userEnteredDimensions}
                onChange={(dimensions) => {
                  form.setValue("dimensions", dimensions);
                }}
              />
              {supportsSchemaBrowser ? (
                <div className="form-group">
                  <label>Query</label>
                  {userEnteredQuery && (
                    <Code
                      language="sql"
                      code={userEnteredQuery}
                      expandable={true}
                    />
                  )}
                  <div>
                    <button
                      className="btn btn-outline-primary"
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        setSqlOpen(true);
                      }}
                    >
                      {userEnteredQuery ? "Edit" : "Add"} SQL{" "}
                      <FaExternalLinkAlt />
                    </button>
                  </div>
                </div>
              ) : (
                <SQLInputField
                  userEnteredQuery={userEnteredQuery}
                  datasourceId={dataSource.id}
                  form={form}
                  requiredColumns={requiredColumns}
                  identityTypes={identityTypes}
                  queryType="experiment-assignment"
                />
              )}
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
};
