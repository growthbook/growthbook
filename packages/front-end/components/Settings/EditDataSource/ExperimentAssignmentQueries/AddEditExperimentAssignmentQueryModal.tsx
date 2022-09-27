import React, { FC } from "react";
import Modal from "../../../Modal";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "back-end/types/datasource";
import { useForm } from "react-hook-form";
import MultiSelectField from "../../../Forms/MultiSelectField";
import Field from "../../../Forms/Field";
import CodeTextArea from "../../../Forms/CodeTextArea";
import Tooltip from "../../../Tooltip";
import Toggle from "../../../Forms/Toggle";
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
  const modalTitle =
    mode === "add"
      ? "Add an Experiment Assignment query"
      : `Edit ${exposureQuery.name}`;

  if (!exposureQuery && mode === "edit") {
    console.error(
      "ImplementationError: exposureQuery is required for Edit mode"
    );
    return null;
  }

  const form = useForm<ExposureQuery>({
    defaultValues: {
      id: exposureQuery?.id || null,
      query: exposureQuery?.query || "",
      name: exposureQuery?.name || "",
      dimensions: exposureQuery?.dimensions || [],
      description: exposureQuery?.description || "",
      hasNameCol: exposureQuery?.hasNameCol || false,
      userIdType: exposureQuery?.userIdType || null,
    },
  });

  const handleSubmit = form.handleSubmit(async (value) => {
    onSave(value);

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

  const events = dataSource.properties?.events || false;

  const identityTypes = dataSource.settings.userIdTypes || [];

  // TODO: Validation logic
  const saveEnabled = true;

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
            {/* TODO: Enable this for Mixpanel */}
            {events && (
              <div>
                <h4 className="font-weight-bold">Experiments</h4>
                {/*<Field*/}
                {/*  label="View Experiment Event"*/}
                {/*  placeholder="$experiment_started"*/}
                {/*  {...form.register("experimentEvent")}*/}
                {/*/>*/}
                {/*<Field*/}
                {/*  label="Experiment Id Property"*/}
                {/*  placeholder="Experiment name"*/}
                {/*  {...form.register("experimentIdProperty")}*/}
                {/*/>*/}
                {/*<Field*/}
                {/*  label="Variation Id Property"*/}
                {/*  placeholder="Variant name"*/}
                {/*  {...form.register("variationIdProperty")}*/}
                {/*/>*/}
              </div>
            )}

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

            <div className="row">
              <div className="col">
                <CodeTextArea
                  label="SQL Query"
                  required
                  language="sql"
                  value={form.watch("query")}
                  setValue={(sql) => form.setValue("query", sql)}
                />
                <div className="form-group">
                  <label className="mr-2">
                    Use Name Columns
                    <Tooltip body="Enable this if you store experiment/variation names as well as ids in your table" />
                  </label>
                  <Toggle
                    id="exposure-query-toggle"
                    value={form.watch("hasNameCol")}
                    setValue={(hasNameCol) => {
                      form.setValue("hasNameCol", hasNameCol);
                    }}
                  />
                </div>

                <StringArrayField
                  label="Dimension Columns"
                  value={form.watch("dimensions")}
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
                    <code>{form.watch("userIdType")}</code>
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
                  {form.watch("hasNameCol") && (
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
