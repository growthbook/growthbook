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
import dynamic from "next/dynamic";
const CodeTextArea = dynamic(
  () => import("../../components/Forms/CodeTextArea"),
  {
    ssr: false,
  }
);

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
  const userIdTypes = useFieldArray({
    control: form.control,
    name: "settings.userIdTypes",
  });

  const userIdTypeOptions = form.watch("settings.userIdTypes").map((t) => {
    return {
      display: t.userIdType,
      value: t.userIdType,
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
              <div className="mb-4">
                <h4>Identifier Types</h4>
                <div>
                  Define all the different units you use to split traffic in an
                  experiment. Some examples: user_id, device_id, ip_address.
                </div>

                {userIdTypes.fields.map((userIdType, i) => {
                  return (
                    <div
                      key={userIdType.id}
                      className="bg-light border my-2 p-3 ml-3"
                    >
                      <div className="row">
                        <div className="col-auto">
                          <h5>
                            {i + 1}.{" "}
                            {form.watch(`settings.userIdTypes.${i}.userIdType`)}
                          </h5>
                        </div>
                        <div className="col-auto ml-auto">
                          <a
                            className="text-danger"
                            href="#"
                            title="Remove identifier type"
                            onClick={(e) => {
                              e.preventDefault();
                              userIdTypes.remove(i);
                            }}
                          >
                            delete
                          </a>
                        </div>
                      </div>
                      <div className="row">
                        <div className="col-md-7 col-lg-8">
                          <Field
                            label="Identifier Type"
                            pattern="^[a-z_]+$"
                            title="Only lowercase letters and underscores allowed"
                            required
                            {...form.register(
                              `settings.userIdTypes.${i}.userIdType`
                            )}
                            helpText="Only lowercase letters and underscores allowed. For example, 'user_id' or 'device_cookie'."
                          />
                          <Field
                            label="Description (optional)"
                            {...form.register(
                              `settings.userIdTypes.${i}.description`
                            )}
                            minRows={1}
                            maxRows={5}
                            textarea
                          />
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
                    userIdTypes.append({
                      userIdType: "",
                      description: "",
                    });
                  }}
                >
                  Add New Identifier Type
                </button>
              </div>

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
                            label="SQL"
                            required
                            syntax="sql"
                            currentValue={form.watch(
                              `settings.queries.exposure.${i}.query`
                            )}
                            setValue={(sql) =>
                              form.setValue(
                                `settings.queries.exposure.${i}.query`,
                                sql
                              )
                            }
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

              {userIdTypeOptions.length > 1 && (
                <div className="mb-4">
                  <h4>Identifier Join Tables</h4>
                  <div>
                    Queries that return a mapping between different identifier
                    types
                  </div>
                  {identityJoins.fields.map((join, i) => {
                    return (
                      <div
                        key={join.id}
                        className="bg-light border my-2 p-3 ml-3"
                      >
                        <div className="row">
                          <div className="col-auto">
                            <h5>
                              {i + 1}.{" "}
                              {form
                                .watch(
                                  `settings.queries.identityJoins.${i}.ids`
                                )
                                ?.join(" + ")}
                            </h5>
                          </div>
                          <div className="col-auto ml-auto">
                            <a
                              className="text-danger"
                              href="#"
                              title="Remove id join table"
                              onClick={(e) => {
                                e.preventDefault();
                                identityJoins.remove(i);
                              }}
                            >
                              delete
                            </a>
                          </div>
                        </div>
                        <div className="row">
                          <div className="col-md-7 col-lg-8">
                            <MultiSelectField
                              label="Identifier Types"
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
                        </div>
                        <div className="row">
                          <div className="col">
                            <CodeTextArea
                              label="SQL Query"
                              syntax="sql"
                              currentValue={form.watch(
                                `settings.queries.identityJoins.${i}.query`
                              )}
                              setValue={(sql) =>
                                form.setValue(
                                  `settings.queries.identityJoins.${i}.query`,
                                  sql
                                )
                              }
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
                    className="btn btn-outline-primary ml-3"
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
                    Add New Identifier Join Table
                  </button>
                </div>
              )}

              <h4>Jupyter Notebook Query Runner (optional)</h4>
              <div className="bg-light border my-2 p-3 ml-3">
                <div className="row mb-3">
                  <div className="col">
                    <CodeTextArea
                      label="Python runQuery definition"
                      syntax="python"
                      placeholder="def runQuery(sql):"
                      {...form.register("settings.notebookRunQuery")}
                      currentValue={form.watch(`settings.notebookRunQuery`)}
                      setValue={(sql) =>
                        form.setValue(`settings.notebookRunQuery`, sql)
                      }
                      helpText="Used when exporting experiment results to a Jupyter notebook"
                    />
                  </div>
                  <div className="col-md-5 col-lg-4">
                    <div className="pt-md-4">
                      Function definition:
                      <ul>
                        <li>
                          Function name: <code>runQuery</code>
                        </li>
                        <li>
                          Arguments: <code>sql</code> (string)
                        </li>
                        <li>
                          Return: <code>df</code> (pandas data frame)
                        </li>
                      </ul>
                      <p>Example for postgres/redshift:</p>
                      <Code
                        language="python"
                        theme="light"
                        code={`import os
import psycopg2
import pandas as pd
from sqlalchemy import create_engine, text

# Use env variables or similar for passwords!
password = os.getenv('POSTGRES_PW')
connStr = f'postgresql+psycopg2://user:{password}@localhost'
dbConnection = create_engine(connStr).connect();

def runQuery(sql):
  return pd.read_sql(text(sql), dbConnection)`}
                      />
                    </div>
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
