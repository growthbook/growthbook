import { FC, useState, useEffect, ChangeEventHandler } from "react";
import { useAuth } from "../../services/auth";
import { getExperimentQuery } from "../../services/datasources";
import track from "../../services/track";
import Modal from "../Modal";
import TextareaAutosize from "react-textarea-autosize";
import { PostgresConnectionParams } from "back-end/types/integrations/postgres";
import {
  DataSourceInterfaceWithParams,
  IdentityJoinQuery,
} from "back-end/types/datasource";
import Field from "../Forms/Field";
import Code from "../Code";

type FormValue = Partial<DataSourceInterfaceWithParams> & {
  dimensions: string;
};

const EditDataSourceSettingsForm: FC<{
  data: Partial<DataSourceInterfaceWithParams>;
  firstTime?: boolean;
  source: string;
  onCancel: () => void;
  onSuccess: () => void;
}> = ({ data, onSuccess, onCancel, firstTime = false, source }) => {
  const [dirty, setDirty] = useState(false);
  const [datasource, setDatasource] = useState<FormValue>(null);

  useEffect(() => {
    track("View Datasource Settings Form", {
      source,
    });
  }, [source]);

  const { apiCall } = useAuth();
  useEffect(() => {
    if (data && !dirty) {
      const identityJoins: IdentityJoinQuery[] = [
        ...data.settings?.queries?.identityJoins,
      ];
      if (!identityJoins.length && data.settings?.queries?.pageviewsQuery) {
        identityJoins.push({
          ids: ["user_id", "anonymous_id"],
          query: data.settings.queries.pageviewsQuery,
        });
      }

      const newValue: FormValue = {
        ...data,
        dimensions: data?.settings?.experimentDimensions?.join(", ") || "",
        settings: {
          notebookRunQuery: data?.settings?.notebookRunQuery || "",
          queries: {
            experimentsQuery: getExperimentQuery(
              data.settings,
              (data.params as PostgresConnectionParams)?.defaultSchema
            ),
            identityJoins,
          },
          events: {
            experimentEvent: "",
            experimentIdProperty: "",
            variationIdProperty: "",
            ...data?.settings?.events,
          },
        },
      };
      setDatasource(newValue);
    }
  }, [data]);

  if (!datasource) {
    return null;
  }

  const handleSubmit = async () => {
    if (!dirty) return;

    const { dimensions, ...fields } = datasource;

    const datasourceValue: Partial<DataSourceInterfaceWithParams> = {
      ...fields,
      settings: {
        ...fields.settings,
        experimentDimensions: dimensions
          .split(",")
          .map((v) => v.trim())
          .filter((v) => !!v),
      },
    };

    // Update
    await apiCall(`/datasource/${data.id}`, {
      method: "PUT",
      body: JSON.stringify(datasourceValue),
    });

    track("Edit Data Source Queries", {
      type: data.type,
      source,
    });

    setDirty(false);
    onSuccess();
  };
  const setSettings = (
    // eslint-disable-next-line
    settings: { [key: string]: any },
    key: "queries" | "events"
  ) => {
    const newVal = {
      ...datasource,
      settings: {
        ...datasource?.settings,
        [key]: {
          ...datasource?.settings[key],
          ...settings,
        },
      },
    };

    setDatasource(newVal as FormValue);
    setDirty(true);
  };
  const onSettingsChange: (
    key: "events" | "queries"
  ) => ChangeEventHandler<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  > = (key) => (e) => {
    setSettings({ [e.target.name]: e.target.value }, key);
  };

  return (
    <Modal
      open={true}
      submit={handleSubmit}
      close={onCancel}
      size="max"
      header={firstTime ? "Query Settings" : "Edit Query Settings"}
      cta="Save"
    >
      {firstTime && (
        <div className="alert alert-success mb-4">
          <strong>Connection successful!</strong> Customize the queries that
          GrowthBook uses to pull experiment results. Need help?{" "}
          <a
            href="https://docs.growthbook.io/app/datasources#configuration-settings"
            target="_blank"
            rel="noopener noreferrer"
          >
            View Documentation
          </a>
        </div>
      )}
      {datasource.properties?.events && (
        <div>
          <h4 className="font-weight-bold">Experiments</h4>
          <div className="form-group">
            <label>View Experiment Event</label>
            <input
              type="text"
              className="form-control"
              name="experimentEvent"
              onChange={onSettingsChange("events")}
              placeholder="$experiment_started"
              value={datasource.settings?.events?.experimentEvent || ""}
            />
          </div>
          <div className="form-group">
            <label>Experiment Id Property</label>
            <input
              type="text"
              className="form-control"
              name="experimentIdProperty"
              onChange={onSettingsChange("events")}
              placeholder="Experiment name"
              value={datasource.settings?.events?.experimentIdProperty || ""}
            />
          </div>

          <div className="form-group">
            <label>Variation Id Property</label>
            <input
              type="text"
              className="form-control"
              name="variationIdProperty"
              onChange={onSettingsChange("events")}
              placeholder="Variant name"
              value={datasource.settings?.events?.variationIdProperty}
            />
          </div>
        </div>
      )}
      {datasource?.properties?.queryLanguage === "sql" && (
        <div>
          <div
            className="row py-2 mb-3 align-items-center bg-light border-bottom"
            style={{ marginTop: "-1rem" }}
          >
            <div className="col-auto">Quick Presets:</div>
            <div className="col-auto">
              <button
                className="btn btn-outline-secondary"
                onClick={(e) => {
                  e.preventDefault();
                  setDatasource({
                    ...datasource,
                    dimensions: "country",
                    settings: {
                      ...datasource.settings,
                      queries: {
                        experimentsQuery: `SELECT
  user_id,
  anonymous_id,
  received_at as timestamp,
  experiment_id,
  variation_id,
  context_location_country as country
FROM
  experiment_viewed`,
                        identityJoins: [
                          {
                            ids: ["user_id", "anonymous_id"],
                            query: `SELECT
  user_id,
  anonymous_id
FROM
  identifies`,
                          },
                        ],
                      },
                    },
                  });
                  setDirty(true);
                }}
              >
                Segment
              </button>
            </div>
          </div>
          <div className="row mb-3">
            <div className="col">
              <div className="form-group">
                <label className="font-weight-bold">Experiments SQL</label>
                <TextareaAutosize
                  required
                  className="form-control"
                  name="experimentsQuery"
                  onChange={onSettingsChange("queries")}
                  value={datasource.settings?.queries?.experimentsQuery}
                  minRows={10}
                  maxRows={20}
                />
                <small className="form-text text-muted">
                  Used to pull experiment results.
                </small>
              </div>
            </div>
            <div className="col-md-5 col-lg-4">
              <div className="pt-md-4">
                One row per variation assignment event. <br />
                <br />
                Minimum required columns:
              </div>
              <ul>
                <li>
                  <code>user_id</code>
                </li>
                <li>
                  <code>anonymous_id</code>
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
              <div>Add additional columns to use as dimensions (see below)</div>
            </div>
          </div>

          <div className="row mb-3">
            <div className="col">
              <div className="form-group">
                <label className="font-weight-bold">Dimension Columns</label>
                <input
                  type="text"
                  className="form-control"
                  name="dimensions"
                  value={datasource.dimensions}
                  onChange={(e) => {
                    setDatasource({
                      ...datasource,
                      dimensions: e.target.value,
                    });
                    setDirty(true);
                  }}
                />
                <small className="form-text text-muted">
                  Separate multiple columns by commas
                </small>
              </div>
            </div>
            <div className="col-md-5 col-lg-4">
              <div className="pt-md-3">
                <p>
                  List any columns from the above query here that you want to
                  use as dimensions to drill down into experiment results.
                </p>
              </div>
            </div>
          </div>
          <div className="row mb-3">
            <div className="col">
              <div className="form-group">
                <label className="font-weight-bold">
                  User Id Join Table{" "}
                  <span style={{ fontWeight: "normal" }}>(optional)</span>
                </label>
                <TextareaAutosize
                  className="form-control"
                  onChange={(e) => {
                    setSettings(
                      {
                        identityJoins: [
                          {
                            ids: ["user_id", "anonymous_id"],
                            query: e.target.value,
                          },
                        ],
                      },
                      "queries"
                    );
                  }}
                  value={
                    datasource.settings?.queries?.identityJoins?.[0]?.query
                  }
                  minRows={5}
                  maxRows={20}
                />
                <small className="form-text text-muted">
                  Used to join between anonymous ids and logged-in user ids when
                  needed.
                </small>
              </div>
            </div>
            <div className="col-md-5 col-lg-4">
              <div className="pt-md-4">Columns to select:</div>
              <ul>
                <li>
                  <code>user_id</code>
                </li>
                <li>
                  <code>anonymous_id</code>
                </li>
              </ul>
            </div>
          </div>
          <div className="row mb-3">
            <div className="col">
              <Field
                label="Jupyter Notebook Query Runner (optional)"
                placeholder="def runQuery(sql):"
                labelClassName="font-weight-bold"
                value={datasource.settings?.notebookRunQuery}
                onChange={(e) => {
                  setDatasource({
                    ...datasource,
                    settings: {
                      ...datasource.settings,
                      notebookRunQuery: e.target.value,
                    },
                  });
                  setDirty(true);
                }}
                textarea
                minRows={5}
                maxRows={20}
                helpText="Used when exporting experiment results to a Jupyter notebook"
              />
            </div>
            <div className="col-md-5 col-lg-4">
              <div className="pt-md-4">
                <p>
                  Define a <code>runQuery</code> Python function for this data
                  source that takes a SQL string argument and returns a pandas
                  data frame. For example:
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
        </div>
      )}
    </Modal>
  );
};

export default EditDataSourceSettingsForm;
