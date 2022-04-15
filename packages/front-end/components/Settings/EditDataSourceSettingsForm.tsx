import { FC, useEffect } from "react";
import { useAuth } from "../../services/auth";
import { getInitialSettings } from "../../services/datasources";
import track from "../../services/track";
import Modal from "../Modal";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import Field from "../Forms/Field";
import Code from "../Code";
import DataSourceSchemaChooser from "./DataSourceSchemaChooser";
import { useFieldArray, useForm } from "react-hook-form";
import StringArrayField from "../Forms/StringArrayField";
import uniqid from "uniqid";
import MultiSelectField from "../Forms/MultiSelectField";

const EditDataSourceSettingsForm: FC<{
  data: Partial<DataSourceInterfaceWithParams>;
  firstTime?: boolean;
  source: string;
  onCancel: () => void;
  onSuccess: () => void;
}> = ({ data, onSuccess, onCancel, firstTime = false, source }) => {
  const form = useForm({
    defaultValues: data,
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
      type: value.type,
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
      display: t,
      value: t,
    };
  });

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
              setValue={(format) => {
                const settings = getInitialSettings(format, params);
                form.setValue("settings.schemaFormat", format);
                form.setValue("settings.userIdTypes", settings.userIdTypes);

                exposure.replace(settings.queries.exposure);
                identityJoins.replace(settings.queries.identityJoins);
              }}
            />
          ) : (
            <>
              <h4>User Id Types</h4>
              <div>
                Define all the different units you use to split traffic in an
                experiment. Some examples: user_id, device_id, ip_address.
              </div>
              <StringArrayField
                value={form.watch("settings.userIdTypes")}
                onChange={(val) => form.setValue("settings.userIdTypes", val)}
              />

              <h4>Experiment Assignment Tables</h4>
              {exposure.fields.map((exp, i) => {
                return (
                  <div key={exp.id} className="bg-light border my-2 p-3">
                    <div className="row">
                      <div className="col">
                        <Field
                          label="Display Name"
                          required
                          {...form.register(
                            `settings.queries.exposure.${i}.name`
                          )}
                        />
                      </div>
                      <div className="col-auto">
                        <button
                          className="btn btn-danger"
                          type="button"
                          title="Remove assignment table"
                          onClick={(e) => {
                            e.preventDefault();
                            exposure.remove(i);
                          }}
                        >
                          &times;
                        </button>
                      </div>
                    </div>
                    <Field
                      label="Description"
                      textarea
                      minRows={1}
                      {...form.register(
                        `settings.queries.exposure.${i}.description`
                      )}
                    />
                    <Field
                      label="User Id Type"
                      options={userIdTypeOptions}
                      required
                      {...form.register(
                        `settings.queries.exposure.${i}.userIdType`
                      )}
                    />
                    <div className="row">
                      <div className="col">
                        <Field
                          label="SQL Query"
                          textarea
                          minRows={10}
                          maxRows={20}
                          required
                          {...form.register(
                            `settings.queries.exposure.${i}.query`
                          )}
                        />

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
                          One row per variation assignment event.{" "}
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
                className="btn btn-outline-primary"
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

              {userIdTypeOptions.length > 1 && (
                <div>
                  <h4>User Id Join Tables</h4>
                  {identityJoins.fields.map((join, i) => {
                    return (
                      <div key={join.id} className="bg-light border my-2 p-3">
                        <div className="row">
                          <div className="col">
                            <MultiSelectField
                              label="User Id Types"
                              value={form.watch(
                                `settings.queries.identityJoins.${i}.ids`
                              )}
                              onChange={(val) => {
                                form.setValue(
                                  `settings.queries.identityJoins.${i}.ids`,
                                  val
                                );
                              }}
                              options={userIdTypeOptions.map((u) => ({
                                value: u.value,
                                label: u.display,
                              }))}
                            />
                          </div>
                          <div className="col-auto">
                            <button
                              className="btn btn-danger"
                              type="button"
                              title="Remove user id join table"
                              onClick={(e) => {
                                e.preventDefault();
                                identityJoins.remove(i);
                              }}
                            >
                              &times;
                            </button>
                          </div>
                        </div>
                        <div className="row">
                          <div className="col">
                            <Field
                              label="SQL Query"
                              textarea
                              minRows={10}
                              maxRows={20}
                              required
                              {...form.register(
                                `settings.queries.identityJoins.${i}.query`
                              )}
                            />
                          </div>
                          <div className="col-md-5 col-lg-4">
                            <div className="pt-md-4">
                              <strong>Required columns</strong>
                            </div>
                            <ul>
                              {form
                                .watch(
                                  `settings.queries.identityJoins.${i}.ids`
                                )
                                .map((id) => (
                                  <li key={id}>
                                    <code>{id}</code>
                                  </li>
                                ))}
                            </ul>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <button
                    className="btn btn-outline-primary"
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      const userIds = userIdTypeOptions
                        .map((u) => u.value)
                        .slice(0, 2);

                      identityJoins.append({
                        ids: userIds,
                        query: `SELECT\n  ${userIds[0]} as ${userIds[0]},\n  ${userIds[1]} as ${userIds[2]}\nFROM my_table`,
                      });
                    }}
                  >
                    Add New User Id Join Table
                  </button>
                </div>
              )}

              <div className="row mb-3">
                <div className="col">
                  <Field
                    label="Jupyter Notebook Query Runner (optional)"
                    placeholder="def runQuery(sql):"
                    labelClassName="font-weight-bold"
                    {...form.register("settings.notebookRunQuery")}
                    textarea
                    minRows={5}
                    maxRows={20}
                    helpText="Used when exporting experiment results to a Jupyter notebook"
                  />
                </div>
                <div className="col-md-5 col-lg-4">
                  <div className="pt-md-4">
                    <p>
                      Define a <code>runQuery</code> Python function for this
                      data source that takes a SQL string argument and returns a
                      pandas data frame. For example:
                    </p>
                    <Code
                      language="python"
                      code={`import os
import psycopg2
import pandas as pd
from sqlalchemy import create_engine, text

# Use environment variables or similar for passwords!
password = os.getenv('POSTGRES_PW')
connStr = f'postgresql+psycopg2://user:{password}@localhost'
dbConnection = create_engine(connStr).connect();

def runQuery(sql):
  return pd.read_sql(text(sql), dbConnection)`}
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
};

export default EditDataSourceSettingsForm;
