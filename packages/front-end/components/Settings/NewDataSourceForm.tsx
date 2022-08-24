import {
  FC,
  useState,
  useEffect,
  ChangeEventHandler,
  ReactElement,
} from "react";
import { useAuth } from "../../services/auth";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import AthenaForm from "./AthenaForm";
import PostgresForm from "./PostgresForm";
import GoogleAnalyticsForm from "./GoogleAnalyticsForm";
import SnowflakeForm from "./SnowflakeForm";
import BigQueryForm from "./BigQueryForm";
import ClickHouseForm from "./ClickHouseForm";
import MixpanelForm from "./MixpanelForm";
import track from "../../services/track";
import PrestoForm from "./PrestoForm";
import MysqlForm from "./MysqlForm";
import SelectField from "../Forms/SelectField";
import { getInitialSettings } from "../../services/datasources";
import PagedModal from "../Modal/PagedModal";
import Page from "../Modal/Page";
import { MdKeyboardArrowDown } from "react-icons/md";
import {
  eventSchemas,
  dataSourceConnections,
  eventSchema,
} from "../../services/eventSchema";
import Field from "../Forms/Field";
import { useForm } from "react-hook-form";
import LoadingOverlay from "../LoadingOverlay";
import styles from "./NewDataSourceForm.module.scss";

const NewDataSourceForm: FC<{
  data: Partial<DataSourceInterfaceWithParams>;
  existing: boolean;
  source: string;
  onCancel: () => void;
  onSuccess: (id: string) => Promise<void>;
}> = ({ data, onSuccess, onCancel, source, existing }) => {
  const [dirty, setDirty] = useState(false);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [schema, setSchema] = useState("");
  const [showFullList, setShowFullList] = useState(false);
  const [possibleTypes, setPossibleTypes] = useState(
    dataSourceConnections.map((d) => d.type)
  );

  const [datasource, setDatasource] = useState<
    Partial<DataSourceInterfaceWithParams>
  >(null);
  const [hasError, setHasError] = useState(false);
  const DEFAULT_DATA_SOURCE: Partial<DataSourceInterfaceWithParams> = {
    name: "My Datasource",
    settings: {},
  };
  const form = useForm({
    defaultValues: {
      settings: data?.settings || DEFAULT_DATA_SOURCE.settings,
    },
  });
  const schemasMap = new Map();
  const dataSourcesMap = new Map();
  eventSchemas.forEach((o) => {
    schemasMap.set(o.value, o);
  });
  dataSourceConnections.forEach((d) => {
    dataSourcesMap.set(d.type, d);
  });
  const selectedSchema = schemasMap.get(schema) || {
    value: "custom",
    label: "Custom",
  };
  useEffect(() => {
    track("View New Datasource Form", {
      source,
    });
  }, [source]);

  const { apiCall } = useAuth();
  useEffect(() => {
    if (data && !dirty) {
      const newValue: Partial<DataSourceInterfaceWithParams> = {
        ...data,
      };
      setDatasource(newValue);
    }
  }, [data]);

  if (!datasource) {
    return null;
  }

  const saveDataConnection = async () => {
    if (!dirty && data.id) return;
    setHasError(false);

    try {
      if (!datasource.type) {
        throw new Error("Please select a data source type");
      }

      // Update
      if (data.id) {
        const res = await apiCall<{ status: number; message: string }>(
          `/datasource/${data.id}`,
          {
            method: "PUT",
            body: JSON.stringify(datasource),
          }
        );
        track("Updating New Datasource Form", {
          source,
          type: datasource.type,
          schema: schema,
        });
        if (res.status > 200) {
          throw new Error(res.message);
        }
      }
      // Create
      else {
        const res = await apiCall<{ id: string }>(`/datasources`, {
          method: "POST",
          body: JSON.stringify({
            ...datasource,
            settings: {
              ...getInitialSettings(
                selectedSchema.value,
                datasource.params,
                form.watch("settings.schemaOptions")
              ),
              ...(datasource.settings || {}),
            },
          }),
        });
        data.id = res.id;
        track("Saving New Datasource Form", {
          source,
          type: datasource.type,
          schema: schema,
        });
      }

      setDirty(false);
    } catch (e) {
      track("Saving New Datasource Form Error", {
        source,
        type: datasource.type,
        error: e.message.substr(0, 32) + "...",
      });
      setHasError(true);
      throw e;
    }
  };

  const updateSettings = async () => {
    const settings = getInitialSettings(
      selectedSchema.value,
      datasource.params,
      form.watch("settings.schemaOptions")
    );
    if (!data.id) {
      throw new Error("Could not find existing data source id");
    }
    const newVal = {
      ...datasource,
      settings,
    };
    setDatasource(newVal as Partial<DataSourceInterfaceWithParams>);
    const res = await apiCall<{ status: number; message: string }>(
      `/datasource/${data.id}`,
      {
        method: "PUT",
        body: JSON.stringify(newVal),
      }
    );
    if (res.status > 200) {
      setLoading(false);
      throw new Error(res.message);
    }
    track("Saving New Datasource Query Settings", {
      source,
      type: datasource.type,
      schema: schema,
    });
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
  const onParamChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    setParams({ [e.target.name]: e.target.value });
  };
  const setSchemaSettings = (s: eventSchema) => {
    setSchema(s.value);
    track("Selected Event Schema", {
      schema: s.value,
      source,
    });
    if (s.types.length === 1) {
      const data = dataSourcesMap.get(s.types[0]);
      setDatasource({
        ...datasource,
        type: s.types[0],
        name: `${s.label}`,
        params: data.default,
      } as Partial<DataSourceInterfaceWithParams>);
    } else {
      setDatasource({
        name: `${s.label}`,
        settings: {},
      });
    }
    setPossibleTypes(s.types);
    if (s.options) {
      s.options.map((o) => {
        form.setValue(`settings.schemaOptions.${o.name}`, o.defaultValue || "");
      });
    } else {
      form.setValue(`settings.schemaOptions`, {});
    }
  };

  const getSchemaCard = (s: eventSchema, i) => (
    <div className={`col-4`} key={i + s.value}>
      <a
        href="#"
        title={s.label}
        onClick={(e) => {
          e.preventDefault();
          setSchemaSettings(s);
          // jump to next step
          setStep(1);
        }}
        className={`${styles.eventCard} btn btn-light-hover btn-outline-${
          s.value === schema ? "selected" : "primary"
        } mb-3`}
        style={{
          backgroundImage: `url(${s.logo})`,
        }}
      />
    </div>
  );

  let connSettings: ReactElement | null = null;
  if (datasource.type === "athena") {
    connSettings = (
      <AthenaForm
        existing={existing}
        onParamChange={onParamChange}
        params={datasource.params}
      />
    );
  } else if (datasource.type === "presto") {
    connSettings = (
      <PrestoForm
        existing={existing}
        onParamChange={onParamChange}
        setParams={setParams}
        params={datasource.params}
      />
    );
  } else if (datasource.type === "redshift") {
    connSettings = (
      <PostgresForm
        existing={existing}
        onParamChange={onParamChange}
        setParams={setParams}
        params={datasource.params}
      />
    );
  } else if (datasource.type === "postgres") {
    connSettings = (
      <PostgresForm
        existing={existing}
        onParamChange={onParamChange}
        setParams={setParams}
        params={datasource.params}
      />
    );
  } else if (datasource.type === "mysql") {
    connSettings = (
      <MysqlForm
        existing={existing}
        onParamChange={onParamChange}
        setParams={setParams}
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
  } else if (datasource.type === "clickhouse") {
    connSettings = (
      <ClickHouseForm
        existing={existing}
        onParamChange={onParamChange}
        setParams={setParams}
        params={datasource.params}
      />
    );
  } else if (datasource.type === "bigquery") {
    connSettings = (
      <BigQueryForm
        setParams={setParams}
        params={datasource.params}
        onParamChange={onParamChange}
      />
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
      header={existing ? "Edit Data Source" : "Add Data Source"}
      close={onCancel}
      submit={async () => {
        await onSuccess(data.id);
      }}
      cta="Save"
      closeCta="Cancel"
      size="lg"
      step={step}
      setStep={setStep}
      backButton={true}
    >
      <Page display="Select Tracking">
        <h4>Common Event Trackers</h4>
        <p>
          GrowthBook does not process experiment data directly, and instead
          connects to your event tracking and data store. GrowthBook has
          out-of-the-box support for a number of database schemas. Choose one
          below, or if you don&apos;t know which, select custom.
        </p>
        <div className="d-flex flex-wrap align-items-stretch align-middle row">
          {eventSchemas
            .filter((s) => s.popular)
            .map((s, i) => {
              return getSchemaCard(s, i);
            })}
        </div>
        <div>
          {showFullList ? (
            <div className="d-flex flex-wrap align-items-stretch align-middle row">
              {eventSchemas
                .filter((s) => !s.popular)
                .map((s, i) => {
                  return getSchemaCard(s, i);
                })}
            </div>
          ) : (
            <div>
              <a
                href="#"
                className="d-block text-center"
                onClick={(e) => {
                  e.preventDefault();
                  setShowFullList(true);
                }}
              >
                Show all supported trackers <MdKeyboardArrowDown />
              </a>
            </div>
          )}
        </div>
        <div className={`row mt-3`}>
          <div className={`col-12`}>
            <h4>Or choose a custom tracking</h4>
            <a
              className={`btn btn-light-hover btn-outline-${
                "custom" === schema ? "selected" : "primary"
              } mb-3 py-3`}
              onClick={(e) => {
                e.preventDefault();
                setSchema("custom");
                setDatasource({
                  name: "My Datasource",
                  settings: {},
                });
                // no options for custom:
                form.setValue(`settings.schemaOptions`, {});

                // set to all possible types:
                setPossibleTypes(dataSourceConnections.map((o) => o.type));
                // jump to next step
                setStep(1);
              }}
              style={{
                height: "90px",
                minWidth: "100%",
              }}
            >
              <h4>Custom Tracking or Unknown</h4>
              <p>
                Connect to your existing data warehouse and define your own
                experiment exposure queries
              </p>
            </a>
          </div>
        </div>
      </Page>
      <Page
        display={`Database connection`}
        validate={async () => {
          if (dirty) {
            setLoading(true);
            try {
              await saveDataConnection();
              setLoading(false);
            } catch (e) {
              setLoading(false);
              throw new Error(e.message);
            }
          }
        }}
      >
        {loading && <LoadingOverlay text="Saving..." />}
        <h3>{selectedSchema.label}</h3>
        {selectedSchema && selectedSchema.intro && (
          <div className="mb-4">{selectedSchema.intro}</div>
        )}
        <SelectField
          label="Data Source Type"
          value={datasource.type}
          onChange={(value) => {
            const option = dataSourceConnections.filter(
              (o) => o.type === value
            )[0];
            if (!option) return;

            track("Data Source Type Selected", {
              type: value,
            });

            setDatasource({
              ...datasource,
              type: option.type,
              params: option.default,
            } as Partial<DataSourceInterfaceWithParams>);
            setDirty(true);
          }}
          disabled={existing || possibleTypes.length === 1}
          required
          autoFocus={true}
          placeholder="Choose Type..."
          options={dataSourceConnections
            .filter((o) => {
              return !!possibleTypes.includes(o.type);
            })
            .map((o) => {
              return {
                value: o.type,
                label: o.display,
              };
            })}
        />
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
        {connSettings}
      </Page>
      <Page
        display={`Query Options`}
        validate={async () => {
          setLoading(true);
          await updateSettings();
          setLoading(false);
        }}
      >
        {loading && <LoadingOverlay text="Saving..." />}
        <h4>{schemasMap.get(schema)?.label || ""} Query Options</h4>
        <div className="my-4">
          <div className="d-inline-block">
            We will create default queries for this data source. The queries can
            be adjusted and changed at any time.
            {selectedSchema?.options
              ? ` Below are are the typical defaults for ${
                  schemasMap.get(schema)?.label
                }.`
              : ""}
          </div>
        </div>
        {selectedSchema?.options && (
          <div>
            {selectedSchema?.options?.map(({ name, label, type, helpText }) => (
              <div key={name} className="form-group">
                <Field
                  label={label}
                  name={name}
                  value={form.watch(`settings.schemaOptions.${name}`)}
                  type={type}
                  onChange={(e) => {
                    form.setValue(
                      `settings.schemaOptions.${name}`,
                      e.target.value
                    );
                  }}
                  helpText={helpText}
                />
              </div>
            ))}
          </div>
        )}
      </Page>
    </PagedModal>
  );
};

export default NewDataSourceForm;
