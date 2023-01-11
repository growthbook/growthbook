import {
  FC,
  useState,
  useEffect,
  ChangeEventHandler,
  ReactElement,
} from "react";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { useForm } from "react-hook-form";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { getInitialSettings } from "@/services/datasources";
import {
  eventSchemas,
  dataSourceConnections,
  eventSchema,
} from "@/services/eventSchema";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "../Forms/SelectField";
import Field from "../Forms/Field";
import Modal from "../Modal";
import { GBCircleArrowLeft } from "../Icons";
import EventSourceList from "./EventSourceList";
import ConnectionSettings from "./ConnectionSettings";

const NewDataSourceForm: FC<{
  data: Partial<DataSourceInterfaceWithParams>;
  existing: boolean;
  source: string;
  onCancel?: () => void;
  onSuccess: (id: string) => Promise<void>;
  importSampleData?: (source: string) => Promise<void>;
  inline?: boolean;
  secondaryCTA?: ReactElement;
}> = ({
  data,
  onSuccess,
  onCancel,
  source,
  existing,
  importSampleData,
  inline,
  secondaryCTA,
}) => {
  const { projects, project } = useDefinitions();
  const [step, setStep] = useState(0);
  const [schema, setSchema] = useState("");
  const [dataSourceId, setDataSourceId] = useState<string | null>(
    data?.id || null
  );
  const [possibleTypes, setPossibleTypes] = useState(
    dataSourceConnections.map((d) => d.type)
  );

  const [datasource, setDatasource] = useState<
    Partial<DataSourceInterfaceWithParams>
  >(data);
  const [lastError, setLastError] = useState("");
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
    track("View Datasource Form", {
      source,
      newDatasourceForm: true,
    });
  }, [source]);

  const { apiCall } = useAuth();

  if (!datasource) {
    return null;
  }

  const saveDataConnection = async () => {
    setLastError("");

    try {
      if (!datasource.type) {
        throw new Error("Please select a data source type");
      }

      // Update
      if (dataSourceId) {
        const res = await apiCall<{ status: number; message: string }>(
          `/datasource/${dataSourceId}`,
          {
            method: "PUT",
            body: JSON.stringify(datasource),
          }
        );
        track("Updating Datasource Form", {
          source,
          type: datasource.type,
          schema: schema,
          newDatasourceForm: true,
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
        track("Submit Datasource Form", {
          source,
          type: datasource.type,
          schema,
          newDatasourceForm: true,
        });
        setDataSourceId(res.id);
        return res.id;
      }
    } catch (e) {
      track("Data Source Form Error", {
        source,
        type: datasource.type,
        error: e.message.substr(0, 32) + "...",
        newDatasourceForm: true,
      });
      setLastError(e.message);
      throw e;
    }
  };

  const updateSettings = async () => {
    const settings = getInitialSettings(
      selectedSchema.value,
      datasource.params,
      form.watch("settings.schemaOptions")
    );
    if (!dataSourceId) {
      throw new Error("Could not find existing data source id");
    }
    const newVal = {
      ...datasource,
      settings,
    };
    setDatasource(newVal as Partial<DataSourceInterfaceWithParams>);
    await apiCall<{ status: number; message: string }>(
      `/datasource/${dataSourceId}`,
      {
        method: "PUT",
        body: JSON.stringify(newVal),
      }
    );
    track("Saving Datasource Query Settings", {
      source,
      type: datasource.type,
      schema: schema,
      newDatasourceForm: true,
    });
  };

  const onChange: ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement> = (
    e
  ) => {
    setDatasource({
      ...datasource,
      [e.target.name]: e.target.value,
    });
  };
  const onManualChange = (name, value) => {
    setDatasource({
      ...datasource,
      [name]: value,
    });
  };

  const setSchemaSettings = (s: eventSchema) => {
    setSchema(s.value);
    form.setValue("settings.schemaFormat", s.value);
    track("Selected Event Schema", {
      schema: s.value,
      source,
      newDatasourceForm: true,
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
        projects: project ? [project] : [],
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

  const hasStep2 = !!selectedSchema?.options;
  const isFinalStep = step === 2 || (!hasStep2 && step === 1);
  const updateSettingsRequired = isFinalStep && dataSourceId && step !== 1;

  const submit =
    step === 0
      ? null
      : async () => {
          let newDataId = dataSourceId;
          if (step === 1) {
            newDataId = await saveDataConnection();
          }
          if (updateSettingsRequired) {
            await updateSettings();
          }
          if (isFinalStep) {
            await onSuccess(newDataId);
            onCancel && onCancel();
          } else {
            setStep(step + 1);
          }
        };

  let stepContents: ReactElement;
  if (step === 0) {
    stepContents = (
      <div>
        <h4>Popular Event Sources</h4>
        <p>
          GrowthBook does not store a copy of your data, and instead queries
          your existing analytics infrastructure. GrowthBook has built-in
          support for a number of popular event sources.
        </p>
        <EventSourceList
          onSelect={(s) => {
            setSchemaSettings(s);
            // jump to next step
            setStep(1);
          }}
        />
        <div className="my-2">
          <strong style={{ fontSize: "1.2em" }}>Don&apos;t see yours?</strong>
        </div>
        <div className={`row`}>
          <div className="col-4">
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
                  projects: project ? [project] : [],
                });
                // no options for custom:
                form.setValue(`settings.schemaOptions`, {});

                // set to all possible types:
                setPossibleTypes(dataSourceConnections.map((o) => o.type));
                // jump to next step
                setStep(1);
              }}
            >
              <h4>Use Custom Source</h4>
              <p className="mb-0 text-dark">
                Manually configure your data schema and analytics queries.
              </p>
            </a>
          </div>
          {importSampleData && (
            <div className="col-4">
              <a
                className={`btn btn-light-hover btn-outline-${
                  "custom" === schema ? "selected" : "primary"
                } mb-3 py-3 ml-auto`}
                onClick={async (e) => {
                  e.preventDefault();
                  await importSampleData("new data source form");
                }}
              >
                <h4>Use Sample Dataset</h4>
                <p className="mb-0 text-dark">
                  Explore GrowthBook with a pre-loaded sample dataset.
                </p>
              </a>
            </div>
          )}
        </div>
        {secondaryCTA && (
          <div className="col-12 text-center">{secondaryCTA}</div>
        )}
      </div>
    );
  } else if (step === 1) {
    stepContents = (
      <div>
        <div className="mb-2">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setLastError("");
              setStep(0);
            }}
          >
            <span style={{ position: "relative", top: "-1px" }}>
              <GBCircleArrowLeft />
            </span>{" "}
            Back
          </a>
        </div>
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

            setLastError("");

            track("Data Source Type Selected", {
              type: value,
              newDatasourceForm: true,
            });

            setDatasource({
              ...datasource,
              type: option.type,
              params: option.default,
            } as Partial<DataSourceInterfaceWithParams>);
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
        <div className="form-group">
          <label>Description</label>
          <textarea
            className="form-control"
            name="description"
            onChange={onChange}
            value={datasource.description}
          />
        </div>
        {projects?.length > 0 && (
          <div className="form-group">
            <MultiSelectField
              label="Projects"
              placeholder="All projects"
              value={datasource.projects || []}
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
              onChange={(v) => onManualChange("projects", v)}
              customClassName="label-overflow-ellipsis"
              helpText="Assign this data source to specific projects"
            />
          </div>
        )}
        <ConnectionSettings
          datasource={datasource}
          existing={existing}
          hasError={!!lastError}
          setDatasource={setDatasource}
        />
      </div>
    );
  } else {
    stepContents = (
      <div>
        <div className="mb-2">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setStep(1);
            }}
          >
            <span style={{ position: "relative", top: "-1px" }}>
              <GBCircleArrowLeft />
            </span>{" "}
            Back
          </a>
        </div>
        <div className="alert alert-success mb-3">
          <strong>Connection successful!</strong>
        </div>
        <h3>{schemasMap.get(schema)?.label || ""} Query Options</h3>
        <div className="my-4">
          <div className="d-inline-block">
            Below are are the typical defaults for{" "}
            {schemasMap.get(schema)?.label || "this data source"}.{" "}
            {selectedSchema?.options?.length === 1
              ? "The value "
              : "These values "}
            are used to generate the queries, which you can adjust as needed at
            any time.
          </div>
        </div>
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
      </div>
    );
  }

  return (
    <Modal
      open={true}
      header={existing ? "Edit Data Source" : "Add Data Source"}
      close={onCancel}
      submit={submit}
      autoCloseOnSubmit={false}
      cta={isFinalStep ? (step === 2 ? "Finish" : "Save") : "Next"}
      closeCta="Cancel"
      size="lg"
      error={lastError}
      inline={inline}
    >
      {stepContents}
    </Modal>
  );
};

export default NewDataSourceForm;
