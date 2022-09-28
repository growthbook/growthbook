import { FC, useEffect } from "react";
import { useAuth } from "../../services/auth";
import { getInitialSettings } from "../../services/datasources";
import track from "../../services/track";
import Modal from "../Modal";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import Field from "../Forms/Field";
import DataSourceSchemaChooser from "./DataSourceSchemaChooser";
import { useFieldArray, useForm } from "react-hook-form";
import StringArrayField from "../Forms/StringArrayField";
import uniqid from "uniqid";
import CodeTextArea from "../Forms/CodeTextArea";
import Toggle from "../Forms/Toggle";
import Tooltip from "../Tooltip";

const EditDataSourceSettingsForm: FC<{
  data: Partial<DataSourceInterfaceWithParams>;
  firstTime?: boolean;
  source: string;
  onCancel: () => void;
  onSuccess: () => void;
}> = ({ data, onSuccess, onCancel, firstTime = false, source }) => {
  const form = useForm({
    defaultValues: {
      settings: data.settings,
    },
  });

  useEffect(() => {
    track("View Datasource Settings Form", {
      source,
    });
  }, [source]);

  const { apiCall } = useAuth();

  const handleSubmit = form.handleSubmit(async (value) => {
    // Update
    await apiCall(`/datasource/${data.id}`, {
      method: "PUT",
      body: JSON.stringify(value),
    });

    track("Edit Data Source Queries", {
      type: data.type,
      schema: value.settings?.schemaFormat || "none",
      source,
    });
    onSuccess();
  });

  const schemaFormat = form.watch("settings.schemaFormat");
  const properties = data.properties;
  const type = data.type;
  const params = data.params;

  const exposure = useFieldArray({
    control: form.control,
    name: "settings.queries.exposure",
  });
  const identityJoins = useFieldArray({
    control: form.control,
    name: "settings.queries.identityJoins",
  });

  const userIdTypeOptions = form.watch("settings.userIdTypes").map((t) => {
    return {
      display: t.userIdType,
      value: t.userIdType,
    };
  });

  const setSchemaSettings = (format) => {
    const settings = getInitialSettings(
      format,
      params,
      form.watch("settings.schemaOptions")
    );
    form.setValue("settings.schemaFormat", format);
    form.setValue("settings.userIdTypes", settings.userIdTypes);

    exposure.replace(settings.queries.exposure);
    identityJoins.replace(settings.queries.identityJoins);
  };

  return (
    <Modal
      open={true}
      submit={handleSubmit}
      close={onCancel}
      size={firstTime && schemaFormat !== "custom" ? "md" : "max"}
      header={firstTime ? "Query Settings" : "Edit Query Settings"}
      cta="Save"
    >
      {properties?.events && (
        <div>
          <h4 className="font-weight-bold">Experiments</h4>
          <Field
            label="View Experiment Event"
            placeholder="$experiment_started"
            {...form.register("settings.events.experimentEvent")}
          />
          <Field
            label="Experiment Id Property"
            placeholder="Experiment name"
            {...form.register("settings.events.experimentIdProperty")}
          />
          <Field
            label="Variation Id Property"
            placeholder="Variant name"
            {...form.register("settings.events.variationIdProperty")}
          />
        </div>
      )}
      {properties?.queryLanguage === "sql" && (
        <div>
          {firstTime && schemaFormat !== "custom" ? (
            <DataSourceSchemaChooser
              format={schemaFormat}
              datasource={type}
              setOptionalValues={(name, value) => {
                if (!name) {
                  form.setValue(`settings.schemaOptions`, null);
                } else {
                  form.setValue(`settings.schemaOptions.${name}`, value);
                }
                setSchemaSettings(schemaFormat);
              }}
              setValue={(format) => {
                setSchemaSettings(format);
              }}
            />
          ) : (
            <>
              <div className="mb-4">
                <h4>Experiment Assignment Tables</h4>
                <div>
                  Queries that return a list of experiment variation assignment
                  events.
                </div>
                {exposure.fields.map((exp, i) => {
                  return (
                    <div key={exp.id} className="bg-light border my-2 p-3 ml-3">
                      <div className="row">
                        <div className="col-auto">
                          <h5>
                            {i + 1}.{" "}
                            {form.watch(`settings.queries.exposure.${i}.name`)}
                          </h5>
                        </div>
                        <div className="col-auto ml-auto">
                          <a
                            className="text-danger"
                            href="#"
                            type="button"
                            title="Remove assignment table"
                            onClick={(e) => {
                              e.preventDefault();
                              exposure.remove(i);
                            }}
                          >
                            delete
                          </a>
                        </div>
                      </div>
                      <div className="row">
                        <div className="col-md-7 col-lg-8">
                          <Field
                            label="Display Name"
                            required
                            {...form.register(
                              `settings.queries.exposure.${i}.name`
                            )}
                          />
                          <Field
                            label="Description (optional)"
                            textarea
                            minRows={1}
                            {...form.register(
                              `settings.queries.exposure.${i}.description`
                            )}
                          />
                          <Field
                            label="Identifier Type"
                            options={userIdTypeOptions}
                            required
                            {...form.register(
                              `settings.queries.exposure.${i}.userIdType`
                            )}
                          />
                        </div>
                      </div>
                      <div className="row">
                        <div className="col">
                          <CodeTextArea
                            label="SQL Query"
                            required
                            language="sql"
                            value={form.watch(
                              `settings.queries.exposure.${i}.query`
                            )}
                            setValue={(sql) => {
                              form.setValue(
                                `settings.queries.exposure.${i}.query`,
                                sql
                              );
                            }}
                          />
                          <div className="form-group">
                            <div className="row">
                              <label className="mr-2">
                                Use Name Columns
                                <Tooltip body="Enable this if you store experiment/variation names as well as ids in your table" />
                              </label>
                              <Toggle
                                id={`exposureQuery${i}`}
                                value={
                                  form.watch(
                                    `settings.queries.exposure.${i}.hasNameCol`
                                  ) || false
                                }
                                setValue={(hasNameCol) => {
                                  form.setValue(
                                    `settings.queries.exposure.${i}.hasNameCol`,
                                    hasNameCol
                                  );
                                }}
                              />
                            </div>
                          </div>

                          <StringArrayField
                            label="Dimension Columns"
                            value={form.watch(
                              `settings.queries.exposure.${i}.dimensions`
                            )}
                            onChange={(dimensions) => {
                              form.setValue(
                                `settings.queries.exposure.${i}.dimensions`,
                                dimensions
                              );
                            }}
                          />
                        </div>
                        <div className="col-md-5 col-lg-4">
                          <div className="pt-md-4">
                            <strong>Required columns</strong>
                          </div>
                          <ul>
                            <li>
                              <code>
                                {form.watch(
                                  `settings.queries.exposure.${i}.userIdType`
                                )}
                              </code>
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
                            {form.watch(
                              `settings.queries.exposure.${i}.hasNameCol`
                            ) && (
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
                            Any additional columns you select can be listed as
                            dimensions to drill down into experiment results.
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <button
                  className="btn btn-outline-primary ml-3"
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    const userId = userIdTypeOptions[0]?.value || "user_id";
                    exposure.append({
                      description: "",
                      id: uniqid("tbl_"),
                      name: "",
                      dimensions: [],
                      query: `SELECT\n  ${userId} as ${userId},\n  timestamp as timestamp,\n  experiment_id as experiment_id,\n  variation_id as variation_id\nFROM my_table`,
                      userIdType: userIdTypeOptions[0]?.value || "",
                    });
                  }}
                >
                  Add New Assignment Table
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
};

export default EditDataSourceSettingsForm;
