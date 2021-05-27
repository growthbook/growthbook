import {
  FC,
  useState,
  useEffect,
  ChangeEventHandler,
  ReactElement,
} from "react";
import { useAuth } from "../../services/auth";
import {
  DataSourceInterfaceWithParams,
  DataSourceType,
  DataSourceParams,
} from "back-end/types/datasource";
import AthenaForm from "./AthenaForm";
import PostgresForm from "./PostgresForm";
import GoogleAnalyticsForm from "./GoogleAnalyticsForm";
import SnowflakeForm from "./SnowflakeForm";
import DataSourceSettingsOverride from "./DataSourceSettingsOverride";
import BigQueryForm from "./BigQueryForm";
import PagedModal from "../Modal/PagedModal";
import Page from "../Modal/Page";
import MixpanelForm from "./MixpanelForm";
import track from "../../services/track";

const typeOptions: {
  type: DataSourceType;
  display: string;
  default: Partial<DataSourceParams>;
}[] = [
  {
    type: "redshift",
    display: "Redshift",
    default: {
      host: "",
      port: 5439,
      database: "",
      user: "",
      password: "",
    },
  },
  {
    type: "google_analytics",
    display: "Google Analytics",
    default: {
      viewId: "",
      customDimension: "1",
      refreshToken: "",
    },
  },
  {
    type: "athena",
    display: "AWS Athena",
    default: {
      bucketUri: "s3://",
      region: "us-east-1",
      database: "",
      accessKeyId: "",
      secretAccessKey: "",
      workGroup: "primary",
    },
  },
  {
    type: "snowflake",
    display: "Snowflake",
    default: {
      account: "",
      username: "",
      password: "",
    },
  },
  {
    type: "postgres",
    display: "Postgres",
    default: {
      host: "",
      port: 5432,
      database: "",
      user: "",
      password: "",
    },
  },
  {
    type: "bigquery",
    display: "BigQuery",
    default: {
      privateKey: "",
      clientEmail: "",
      projectId: "",
    },
  },
  {
    type: "mixpanel",
    display: "Mixpanel",
    default: {
      username: "",
      secret: "",
      projectId: "",
    },
  },
];

const DataSourceForm: FC<{
  data: Partial<DataSourceInterfaceWithParams>;
  existing: boolean;
  source: string;
  onCancel: () => void;
  onSuccess: () => void;
}> = ({ data, onSuccess, onCancel, source, existing }) => {
  const [dirty, setDirty] = useState(false);
  const [datasource, setDatasource] = useState<
    Partial<DataSourceInterfaceWithParams>
  >(null);
  const [hasError, setHasError] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    track("View Datasource Form", {
      source,
    });
  }, [source]);

  const { apiCall } = useAuth();
  useEffect(() => {
    if (data && !dirty) {
      const newValue: Partial<DataSourceInterfaceWithParams> = {
        ...data,
        settings: {
          experiments: {
            experimentIdColumn: "",
            table: "",
            timestampColumn: "",
            userIdColumn: "",
            anonymousIdColumn: "",
            variationColumn: "",
            variationFormat: "",
            ...data?.settings?.experiments,
          },
          identifies: {
            table: "",
            anonymousIdColumn: "",
            userIdColumn: "",
            ...data?.settings?.identifies,
          },
          default: {
            timestampColumn: "",
            userIdColumn: "",
            anonymousIdColumn: "",
            ...data?.settings?.default,
          },
          pageviews: {
            table: "",
            timestampColumn: "",
            urlColumn: "",
            userIdColumn: "",
            anonymousIdColumn: "",
            ...data?.settings?.pageviews,
          },
          users: {
            table: "",
            userIdColumn: "",
            ...data?.settings?.users,
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
    if (!dirty && data.id) return;
    setHasError(false);

    try {
      // Update
      if (data.id) {
        const res = await apiCall<{ status: number; message: string }>(
          `/datasource/${data.id}`,
          {
            method: "PUT",
            body: JSON.stringify(datasource),
          }
        );
        if (res.status > 200) {
          throw new Error(res.message);
        }
      }
      // Create
      else {
        const res = await apiCall<{ status: number; message: string }>(
          `/datasources`,
          {
            method: "POST",
            body: JSON.stringify(datasource),
          }
        );
        if (res.status > 200) {
          throw new Error(res.message);
        }
        track("Submit Datasource Form", {
          source,
          type: datasource.type,
        });
      }

      setDirty(false);
      onSuccess();
    } catch (e) {
      setHasError(true);
      throw e;
    }
  };

  const onChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    setDatasource({
      ...datasource,
      [e.target.name]: e.target.value,
    });
    setDirty(true);
  };
  const setParams = (params: { [key: string]: string }) => {
    const newVal = {
      ...datasource,
      params: {
        ...datasource.params,
        ...params,
      },
    };

    setDatasource(newVal as Partial<DataSourceInterfaceWithParams>);
    setDirty(true);
  };
  const setSettings = (settings: { [key: string]: string }, key: string) => {
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

    setDatasource(newVal as Partial<DataSourceInterfaceWithParams>);
    setDirty(true);
  };
  const onParamChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    setParams({ [e.target.name]: e.target.value });
  };
  const onSettingsChange: (
    key: string
  ) => ChangeEventHandler<HTMLInputElement | HTMLSelectElement> = (key) => (
    e
  ) => {
    setSettings({ [e.target.name]: e.target.value }, key);
  };
  const settingsSupported = !["google_analytics"].includes(datasource.type);

  let connSettings: ReactElement | null = null;
  if (datasource.type === "athena") {
    connSettings = (
      <AthenaForm
        existing={existing}
        onParamChange={onParamChange}
        params={datasource.params}
      />
    );
  } else if (datasource.type === "redshift") {
    connSettings = (
      <PostgresForm
        existing={existing}
        onParamChange={onParamChange}
        params={datasource.params}
      />
    );
  } else if (datasource.type === "postgres") {
    connSettings = (
      <PostgresForm
        existing={existing}
        onParamChange={onParamChange}
        params={datasource.params}
      />
    );
  } else if (datasource.type === "google_analytics") {
    connSettings = (
      <GoogleAnalyticsForm
        existing={existing}
        onParamChange={onParamChange}
        setParams={setParams}
        params={datasource.params}
        error={hasError}
      />
    );
  } else if (datasource.type === "snowflake") {
    connSettings = (
      <SnowflakeForm
        existing={existing}
        onParamChange={onParamChange}
        params={datasource.params}
      />
    );
  } else if (datasource.type === "bigquery") {
    connSettings = (
      <BigQueryForm setParams={setParams} params={datasource.params} />
    );
  } else if (datasource.type === "mixpanel") {
    connSettings = (
      <MixpanelForm
        existing={existing}
        onParamChange={onParamChange}
        params={datasource.params}
      />
    );
  }

  return (
    <PagedModal
      submit={handleSubmit}
      step={step}
      setStep={setStep}
      close={onCancel}
      size="lg"
      header={existing ? "Edit Data Source" : "Add Data Source"}
      cta="Save"
    >
      <Page display="Basic Info">
        <div className="form-group">
          <label>Display Name</label>
          <input
            type="text"
            className="form-control"
            name="name"
            required
            onChange={onChange}
            value={datasource.name}
          />
        </div>
        <div className="form-group">
          <label>Type</label>
          <select
            className="form-control"
            value={datasource.type}
            disabled={existing}
            onChange={(e) => {
              const option = typeOptions.filter(
                (o) => o.type === e.target.value
              )[0];
              if (!option) return;

              setDatasource({
                ...datasource,
                type: option.type,
                params: option.default,
              } as Partial<DataSourceInterfaceWithParams>);
              setDirty(true);
            }}
          >
            <option value="">Choose Type...</option>
            {typeOptions.map(({ type, display }) => (
              <option value={type} key={type}>
                {display}
              </option>
            ))}
          </select>
        </div>
      </Page>
      <Page enabled={!!connSettings} display="Connection">
        {connSettings}
      </Page>
      <Page display="Settings" enabled={settingsSupported}>
        {datasource.type === "mixpanel" && (
          <div className="mt-3">
            <h4>Experiments</h4>
            <div className="form-group">
              <label>View Experiment Event</label>
              <input
                type="text"
                className="form-control"
                name="table"
                onChange={onSettingsChange("experiments")}
                placeholder="$experiment_started"
                value={datasource.settings?.experiments?.table || ""}
              />
            </div>
            <div className="form-group">
              <label>Experiment Id Property</label>
              <input
                type="text"
                className="form-control"
                name="experimentIdColumn"
                onChange={onSettingsChange("experiments")}
                placeholder="Experiment name"
                value={
                  datasource.settings?.experiments?.experimentIdColumn || ""
                }
              />
            </div>

            <div className="form-group">
              <label>Variation Id Property</label>
              <input
                type="text"
                className="form-control"
                name="variationColumn"
                onChange={onSettingsChange("experiments")}
                placeholder="Variant name"
                value={datasource.settings?.experiments?.variationColumn}
              />
            </div>

            <div className="form-group">
              <label>Variation Id Format</label>
              <select
                className="form-control"
                name="variationFormat"
                onChange={onSettingsChange("experiments")}
                required
                value={
                  datasource.settings?.experiments?.variationFormat || "index"
                }
              >
                <option value="index">(0=control, 1=1st variation, ...)</option>
                <option value="key">Unique String Keys</option>
              </select>
            </div>
            <hr />
            <h4>Page Views</h4>
            <div className="form-group">
              <label>Page Views Event</label>
              <input
                type="text"
                className="form-control"
                name="table"
                placeholder="Page view"
                onChange={onSettingsChange("pageviews")}
                value={datasource.settings?.pageviews?.table || ""}
              />
            </div>
            <div className="form-group">
              <label>URL Path Property</label>
              <input
                type="text"
                className="form-control"
                name="urlColumn"
                placeholder="path"
                onChange={onSettingsChange("pageviews")}
                value={datasource.settings?.pageviews?.urlColumn || ""}
              />
            </div>
          </div>
        )}
        {settingsSupported && datasource.type !== "mixpanel" && (
          <div className="mt-3">
            <div className="row py-2 mb-3 align-items-center bg-white border-top border-bottom">
              <div className="col-auto">Quick Presets:</div>
              <div className="col-auto">
                <button
                  className="btn btn-outline-secondary"
                  onClick={(e) => {
                    e.preventDefault();
                    setDatasource({
                      ...datasource,
                      settings: {
                        default: {
                          userIdColumn: "user_id",
                          timestampColumn: "received_at",
                          anonymousIdColumn: "anonymous_id",
                        },
                        identifies: {
                          table: "identifies",
                        },
                        experiments: {
                          table: "experiment_viewed",
                          variationFormat: "index",
                          experimentIdColumn: "experiment_id",
                          variationColumn: "variation_id",
                        },
                        pageviews: {
                          table: "pages",
                          urlColumn: "path",
                        },
                        users: {
                          table: "users",
                        },
                      },
                    });
                    setDirty(true);
                  }}
                >
                  Segment
                </button>
              </div>
              <div className="col-auto">
                <button
                  className="btn btn-outline-secondary"
                  onClick={(e) => {
                    e.preventDefault();
                    setDatasource({
                      ...datasource,
                      settings: {
                        default: {
                          userIdColumn: "user_id",
                          timestampColumn: "time",
                          anonymousIdColumn: "anonymous_id",
                        },
                        identifies: {
                          table: "identifies",
                        },
                        experiments: {
                          table: "experiment_viewed",
                          variationFormat: "index",
                          experimentIdColumn: "experiment_id",
                          variationColumn: "variation_id",
                        },
                        pageviews: {
                          table: "pages",
                          urlColumn: "path",
                        },
                        users: {
                          table: "users",
                          userIdColumn: "id",
                        },
                      },
                    });
                    setDirty(true);
                  }}
                >
                  Freshpaint
                </button>
              </div>
            </div>
            <div className="row">
              <div className="col-md-6">
                <div className="bg-white p-3 border mb-3">
                  <h6 className="mb-3 text-center font-weight-bold">
                    Defaults
                  </h6>
                  <div className="form-group">
                    <label>User Id Column</label>
                    <input
                      type="text"
                      required
                      className="form-control"
                      name="userIdColumn"
                      onChange={onSettingsChange("default")}
                      value={datasource.settings?.default?.userIdColumn || ""}
                    />
                  </div>
                  <div className="form-group">
                    <label>Anonymous Id Column</label>
                    <input
                      type="text"
                      required
                      className="form-control"
                      name="anonymousIdColumn"
                      onChange={onSettingsChange("default")}
                      value={
                        datasource.settings?.default?.anonymousIdColumn || ""
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Timestamp Column</label>
                    <input
                      type="text"
                      required
                      className="form-control"
                      name="timestampColumn"
                      onChange={onSettingsChange("default")}
                      value={
                        datasource.settings?.default?.timestampColumn || ""
                      }
                    />
                  </div>
                </div>
              </div>
              <div className="col-md-6">
                <div className="bg-white p-3 border mb-3">
                  <h6 className="mb-3 text-center font-weight-bold">
                    Page Views
                  </h6>
                  <div className="form-group">
                    <label>Page Views Table</label>
                    <input
                      type="text"
                      required
                      className="form-control"
                      name="table"
                      onChange={onSettingsChange("pageviews")}
                      value={datasource.settings?.pageviews?.table || ""}
                    />
                  </div>
                  <div className="form-group">
                    <label>URL Path Column</label>
                    <input
                      type="text"
                      required
                      className="form-control"
                      name="urlColumn"
                      onChange={onSettingsChange("pageviews")}
                      value={datasource.settings?.pageviews?.urlColumn || ""}
                    />
                  </div>
                  <DataSourceSettingsOverride
                    value={datasource.settings?.pageviews}
                    defaultValue={datasource.settings?.default}
                    onChange={onSettingsChange("pageviews")}
                  />
                </div>
              </div>

              <div className="col-md-6">
                <div className="bg-white p-3 border mb-3">
                  <h6 className="mb-3 text-center font-weight-bold">Users</h6>
                  <div className="form-group">
                    <label>Users Table</label>
                    <input
                      type="text"
                      required
                      className="form-control"
                      name="table"
                      onChange={onSettingsChange("users")}
                      value={datasource.settings?.users?.table || ""}
                    />
                  </div>
                  <DataSourceSettingsOverride
                    value={datasource.settings?.users}
                    defaultValue={datasource.settings?.default}
                    onChange={onSettingsChange("users")}
                    noTimestamp={true}
                    noAnonymousId={true}
                  />
                </div>
              </div>
              <div className="col-md-6">
                <div className="bg-white p-3 border mb-3">
                  <h6 className="mb-3 text-center font-weight-bold">
                    Anonymous Id Mapping
                  </h6>
                  <div className="form-group">
                    <label>Anonymous Id Mapping Table</label>
                    <input
                      type="text"
                      required
                      className="form-control"
                      name="table"
                      onChange={onSettingsChange("identifies")}
                      value={datasource.settings?.identifies?.table || ""}
                    />
                  </div>
                  <DataSourceSettingsOverride
                    value={datasource.settings?.identifies}
                    defaultValue={datasource.settings?.default}
                    onChange={onSettingsChange("identifies")}
                    noTimestamp={true}
                  />
                </div>
              </div>
              <div className="col-md-6">
                <div className="bg-white p-3 border mb-3">
                  <h6 className="mb-3 text-center font-weight-bold">
                    Experiment Views
                  </h6>

                  <div className="form-group">
                    <label>View Experiment Table</label>
                    <input
                      type="text"
                      className="form-control"
                      name="table"
                      onChange={onSettingsChange("experiments")}
                      required
                      value={datasource.settings?.experiments?.table || ""}
                    />
                  </div>
                  <div className="form-group">
                    <label>Experiment Id Column</label>
                    <input
                      type="text"
                      className="form-control"
                      name="experimentIdColumn"
                      onChange={onSettingsChange("experiments")}
                      required
                      value={
                        datasource.settings?.experiments?.experimentIdColumn ||
                        ""
                      }
                    />
                  </div>

                  <div className="form-group">
                    <label>Variation Id Column</label>
                    <input
                      type="text"
                      className="form-control"
                      name="variationColumn"
                      onChange={onSettingsChange("experiments")}
                      required
                      value={datasource.settings?.experiments?.variationColumn}
                    />
                  </div>

                  <div className="form-group">
                    <label>Variation Id Format</label>
                    <select
                      className="form-control"
                      name="variationFormat"
                      onChange={onSettingsChange("experiments")}
                      required
                      value={
                        datasource.settings?.experiments?.variationFormat ||
                        "index"
                      }
                    >
                      <option value="index">
                        (0=control, 1=1st variation, ...)
                      </option>
                      <option value="key">Unique String Keys</option>
                    </select>
                  </div>
                  <DataSourceSettingsOverride
                    value={datasource.settings?.experiments}
                    defaultValue={datasource.settings?.default}
                    onChange={onSettingsChange("experiments")}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </Page>
    </PagedModal>
  );
};

export default DataSourceForm;
