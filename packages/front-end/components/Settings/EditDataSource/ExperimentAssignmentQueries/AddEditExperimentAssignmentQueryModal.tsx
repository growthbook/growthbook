import React, { FC, useMemo, useState } from "react";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "back-end/types/datasource";
import { useForm } from "react-hook-form";
import cloneDeep from "lodash/cloneDeep";
import uniqId from "uniqid";
import SchemaBrowser from "@/components/SchemaBrowser";
import { CursorData } from "@/components/Segments/SegmentForm";
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
  const [cursorData, setCursorData] = useState<null | CursorData>(null);
  const updateSqlInput = (sql: string) => {
    form.setValue("query", sql);
  };
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
  const supportsSchemaBrowser = dataSource.properties.supportsInformationSchema;

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
    <Modal
      open={true}
      submit={handleSubmit}
      close={onCancel}
      size={supportsSchemaBrowser ? "max" : "lg"}
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
            <div className="row">
              <div
                className={
                  supportsSchemaBrowser ? "col-xs-12 col-md-7" : "col-12"
                }
              >
                <SQLInputField
                  userEnteredQuery={userEnteredQuery}
                  datasourceId={dataSource.id}
                  form={form}
                  requiredColumns={requiredColumns}
                  identityTypes={identityTypes}
                  queryType="experiment-assignment"
                  setCursorData={setCursorData}
                />
              </div>
              {supportsSchemaBrowser && (
                <div className="d-none d-md-block col-5">
                  <SchemaBrowser
                    updateSqlInput={updateSqlInput}
                    datasource={dataSource}
                    cursorData={cursorData}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};
