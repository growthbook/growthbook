import { FC, useState, useEffect, ChangeEventHandler } from "react";
import { useAuth } from "../../services/auth";
import {
  getExperimentQuery,
  getPageviewsQuery,
} from "../../services/datasources";
import track from "../../services/track";
import Modal from "../Modal";
import TextareaAutosize from "react-textarea-autosize";
import { PostgresConnectionParams } from "back-end/types/integrations/postgres";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import Field from "../Forms/Field";

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
            pageviewsQuery: getPageviewsQuery(
              data.settings,
              (data.params as PostgresConnectionParams)?.defaultSchema
            ),
          },
          events: {
            experimentEvent: "",
            experimentIdProperty: "",
            variationIdProperty: "",
            pageviewEvent: "",
            urlProperty: "",
            ...data?.settings?.events,
          },
          variationIdFormat:
            data?.settings?.variationIdFormat ||
            data?.settings?.experiments?.variationFormat ||
            "index",
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
    settings: { [key: string]: string },
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
  const settingsSupported = !["google_analytics"].includes(datasource.type);

  return (
    <Modal
      open={true}
      submit={handleSubmit}
      close={onCancel}
      size="lg"
      header={firstTime ? "Query Settings" : "Edit Queries"}
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
      {datasource.type === "mixpanel" && (
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

          <div className="form-group">
            <label>Variation Id Format</label>
            <select
              className="form-control"
              name="variationFormat"
              onChange={(e) => {
                setDatasource({
                  ...datasource,
                  settings: {
                    ...datasource.settings,
                    variationIdFormat: e.target.value as "index" | "key",
                  },
                });
                setDirty(true);
              }}
              required
              value={datasource.settings?.variationIdFormat || "index"}
            >
              <option value="index">(0=control, 1=1st variation, ...)</option>
              <option value="key">Unique String Keys</option>
            </select>
          </div>
          <hr />
          <h4 className="font-weight-bold">Page Views</h4>
          <div className="form-group">
            <label>Page Views Event</label>
            <input
              type="text"
              className="form-control"
              name="pageviewEvent"
              placeholder="Page view"
              onChange={onSettingsChange("events")}
              value={datasource.settings?.events?.pageviewEvent || ""}
            />
          </div>
          <div className="form-group">
            <label>URL Path Property</label>
            <input
              type="text"
              className="form-control"
              name="urlProperty"
              placeholder="path"
              onChange={onSettingsChange("events")}
              value={datasource.settings?.events?.urlProperty || ""}
            />
          </div>
        </div>
      )}
      {settingsSupported && datasource.type !== "mixpanel" && (
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
                        pageviewsQuery: `SELECT
  user_id,
  anonymous_id,
  received_at as timestamp,
  path as url
FROM
  pages`,
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
                <label className="font-weight-bold">Variation Id Format</label>
                <select
                  className="form-control"
                  name="variationFormat"
                  onChange={(e) => {
                    setDatasource({
                      ...datasource,
                      settings: {
                        ...datasource.settings,
                        variationIdFormat: e.target.value as "index" | "key",
                      },
                    });
                    setDirty(true);
                  }}
                  required
                  value={datasource.settings?.variationIdFormat || "index"}
                >
                  <option value="index">Array Index</option>
                  <option value="key">String Keys</option>
                </select>
              </div>
            </div>
            <div className="col-md-5 col-lg-4">
              <div className="pt-md-3">
                <p>
                  <strong>Array Index</strong> (<code>0</code>, <code>1</code>,{" "}
                  <code>2</code>, etc.)
                </p>
                <p>
                  <strong>String Keys</strong> (<code>blue-buttons</code>,{" "}
                  <code>control</code>, etc.)
                </p>
              </div>
            </div>
          </div>

          <div className="row mb-3">
            <div className="col">
              <div className="form-group">
                <label className="font-weight-bold">Pageviews SQL</label>
                <TextareaAutosize
                  required
                  className="form-control"
                  name="pageviewsQuery"
                  onChange={onSettingsChange("queries")}
                  value={datasource.settings?.queries?.pageviewsQuery}
                  minRows={8}
                  maxRows={20}
                />
                <small className="form-text text-muted">
                  Used to predict running time before an experiment starts.
                </small>
              </div>
            </div>
            <div className="col-md-5 col-lg-4">
              <div className="pt-md-4">
                One row per page view. Required column names:
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
                  <code>url</code>
                </li>
              </ul>
            </div>
          </div>

          <div className="row mb-3">
            <div className="col">
              <Field
                label="Jupyter Notebook Query Runner"
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
                  data frame.
                </p>
                <p>
                  Note: <code>pandas</code> and <code>NumPy (np)</code> are
                  already available so you don&apos;t need to import them.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default EditDataSourceSettingsForm;
