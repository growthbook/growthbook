import {
  FC,
  useState,
  useEffect,
  ChangeEventHandler,
  ReactElement,
} from "react";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { dataSourceConnections } from "@/services/eventSchema";
import Button from "@/components/Button";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { getInitialSettings } from "@/services/datasources";
import { DocLink, DocSection } from "@/components/DocLink";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import Modal from "@/components/Modal";
import ConnectionSettings from "@/components/Settings/ConnectionSettings";
import { useDefinitions } from "@/services/DefinitionsContext";

const typeOptions = dataSourceConnections;

const DataSourceForm: FC<{
  data: Partial<DataSourceInterfaceWithParams>;
  existing: boolean;
  source: string;
  onCancel?: () => void;
  onSuccess: (id: string) => Promise<void>;
  importSampleData?: () => Promise<void>;
  inline?: boolean;
  cta?: string;
  secondaryCTA?: ReactElement;
}> = ({
  data,
  onSuccess,
  onCancel,
  source,
  existing,
  importSampleData,
  inline,
  cta = "Save",
  secondaryCTA,
}) => {
  const { projects } = useDefinitions();
  const [dirty, setDirty] = useState(false);
  const [datasource, setDatasource] = useState<
    Partial<DataSourceInterfaceWithParams>
  >(null);
  const [hasError, setHasError] = useState(false);

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
      };
      setDatasource(newValue);
    }
  }, [data, dirty]);

  if (!datasource) {
    return null;
  }

  const handleSubmit = async () => {
    if (!dirty && data.id) return;
    setHasError(false);

    try {
      if (!datasource.type) {
        throw new Error("Please select a data source type");
      }

      let id = data.id;

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
        const res = await apiCall<{ id: string }>(`/datasources`, {
          method: "POST",
          body: JSON.stringify({
            ...datasource,
            settings: {
              ...getInitialSettings("custom", datasource.params),
              ...(datasource.settings || {}),
            },
          }),
        });
        id = res.id;
        track("Submit Datasource Form", {
          source,
          type: datasource.type,
        });
      }

      setDirty(false);
      await onSuccess(id);
    } catch (e) {
      track("Data Source Form Error", {
        source,
        type: datasource.type,
        error: e.message.substr(0, 32) + "...",
      });
      setHasError(true);
      throw e;
    }
  };

  const onChange: ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement> = (
    e
  ) => {
    setDatasource({
      ...datasource,
      [e.target.name]: e.target.value,
    });
    setDirty(true);
  };
  const onManualChange = (name, value) => {
    setDatasource({
      ...datasource,
      [name]: value,
    });
    setDirty(true);
  };

  return (
    <Modal
      inline={inline}
      open={true}
      submit={handleSubmit}
      close={onCancel}
      header={existing ? "Edit Data Source" : "Add Data Source"}
      cta={cta}
      size="lg"
      secondaryCTA={secondaryCTA}
    >
      {importSampleData && !datasource.type && (
        <div className="alert alert-info">
          <div className="row align-items-center">
            <div className="col">
              <div>
                <strong>Not ready to connect to your data source?</strong>
              </div>{" "}
              Try out GrowthBook first with a sample dataset.
            </div>
            <div className="col-auto">
              <Button
                color="info"
                className="btn-sm"
                onClick={async () => {
                  await importSampleData();
                }}
              >
                Use Sample Data
              </Button>
            </div>
          </div>
        </div>
      )}
      <SelectField
        label="Data Source Type"
        value={datasource.type}
        onChange={(value) => {
          const option = typeOptions.filter((o) => o.type === value)[0];
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
        disabled={existing}
        required
        autoFocus={true}
        placeholder="Choose Type..."
        options={typeOptions.map((o) => {
          return {
            value: o.type,
            label: o.display,
          };
        })}
        helpText={
          <DocLink
            docSection={datasource.type as DocSection}
            fallBackSection="datasources"
          >
            View documentation
          </DocLink>
        }
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
        hasError={hasError}
        setDatasource={setDatasource}
        setDirty={setDirty}
      />
    </Modal>
  );
};

export default DataSourceForm;
