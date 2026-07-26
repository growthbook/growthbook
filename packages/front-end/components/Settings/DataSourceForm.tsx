import {
  FC,
  useState,
  useEffect,
  ChangeEventHandler,
  ReactElement,
} from "react";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { isSampleDatasource } from "shared/demo-datasource";
import { dataSourceConnections } from "@/services/eventSchema";
import Button from "@/ui/Button";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import MultiSelectField from "@/ui/MultiSelectField";
import { getInitialSettings } from "@/services/datasources";
import { DocLink, DocSection } from "@/components/DocLink";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import Modal from "@/components/Modal";
import ConnectionSettings from "@/components/Settings/ConnectionSettings";
import { useDefinitions } from "@/services/DefinitionsContext";
import { ensureAndReturn } from "@/types/utils";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useProjectOptions from "@/hooks/useProjectOptions";
import Tooltip from "@/components/Tooltip/Tooltip";
import Callout from "@/ui/Callout";
import EditSchemaOptions from "./EditSchemaOptions";

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
  const { apiCall, orgId } = useAuth();
  const [dirty, setDirty] = useState(false);
  const [datasource, setDatasource] = useState<
    Partial<DataSourceInterfaceWithParams> | undefined
  >();
  const [hasError, setHasError] = useState(false);
  const permissionsUtil = usePermissionsUtil();

  // Lock the sample Data Source connection: the constant-ID seeded one, plus
  // legacy seeds matched the same way the back-end identifies them for
  // "Delete Sample Data". If a sample connection were repurposed to point at
  // a real database, "Delete Sample Data" would still remove it, so editing
  // it is never safe.
  const isSampleData = isSampleDatasource({
    datasourceId: data.id,
    type: data.type,
    host: data.params && "host" in data.params ? data.params.host : undefined,
    projects: data.projects,
    organizationId: orgId ?? undefined,
  });

  const permissionRequired = (project: string) => {
    return existing
      ? permissionsUtil.canUpdateDataSourceParams({
          projects: [project],
          type: datasource?.type,
        })
      : permissionsUtil.canCreateDataSource({
          projects: [project],
          type: datasource?.type,
        });
  };

  const projectOptions = useProjectOptions(
    permissionRequired,
    datasource?.projects || [],
  );

  useEffect(() => {
    track("View Datasource Form", {
      source,
    });
  }, [source]);

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
      if (id) {
        const putBody = { ...datasource };
        // Event Forwarder uses dedicated endpoints; omit from generic datasource PUT.
        delete putBody.eventForwarderConfig;
        const res = await apiCall<{ status: number; message: string }>(
          `/datasource/${data.id}`,
          {
            method: "PUT",
            body: JSON.stringify(putBody),
          },
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
              ...getInitialSettings(
                "custom",
                ensureAndReturn(datasource.params),
              ),
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
    e,
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
      useRadixButton={false}
      trackingEventModalType=""
      inline={inline}
      open={true}
      submit={handleSubmit}
      close={onCancel}
      header={existing ? "Edit Data Source" : "Add Data Source"}
      cta={cta}
      size="lg"
      secondaryCTA={secondaryCTA}
      ctaEnabled={!isSampleData}
      disabledMessage={
        isSampleData
          ? "You cannot edit the sample data source connection."
          : undefined
      }
    >
      {importSampleData && !datasource.type && (
        <Callout
          status="info"
          action={
            <Button
              color="inherit"
              onClick={async () => {
                await importSampleData();
              }}
            >
              Use Sample Data
            </Button>
          }
        >
          <div>
            <strong>Not ready to connect to your data source?</strong>
          </div>{" "}
          Try out GrowthBook first with a sample dataset.
        </Callout>
      )}
      <SelectField
        size="legacy"
        label="Data Source Type"
        value={datasource.type || typeOptions[0].type}
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
            eventForwarderConfig: null,
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
            useRadix={false}
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
        <Field
          textarea
          minRows={1}
          maxLength={MAX_DESCRIPTION_LENGTH}
          name="description"
          onChange={onChange}
          value={datasource.description}
        />
      </div>
      {projects?.length > 0 && (
        <div className="form-group">
          <MultiSelectField
            size="legacy"
            label={
              <>
                Projects{" "}
                <Tooltip
                  body={`The dropdown below has been filtered to only include projects where you have permission to ${
                    existing ? "update" : "create"
                  } Data Sources.`}
                />
              </>
            }
            placeholder="All Projects"
            value={datasource.projects || []}
            options={projectOptions}
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
      <EditSchemaOptions
        datasource={datasource}
        setDatasource={setDatasource}
        setDirty={setDirty}
      />
    </Modal>
  );
};

export default DataSourceForm;
