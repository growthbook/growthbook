import {
  FC,
  useState,
  useEffect,
  ChangeEventHandler,
  useCallback,
  ReactNode,
} from "react";
import {
  DataSourceInterfaceWithParams,
  SchemaFormat,
} from "shared/types/datasource";
import { useForm } from "react-hook-form";
import { isDemoDatasourceProject } from "shared/demo-datasource";
import { FaExternalLinkAlt } from "react-icons/fa";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { Text } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import {
  createInitialResources,
  getInitialDatasourceResources,
} from "@/services/initial-resources";
import { getInitialSettings } from "@/services/datasources";
import {
  eventSchemas,
  dataSourceConnections,
  eventSchema,
} from "@/services/eventSchema";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import Modal from "@/components/Modal";
import { GBCircleArrowLeft } from "@/components/Icons";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useProjectOptions from "@/hooks/useProjectOptions";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import useOrgSettings from "@/hooks/useOrgSettings";
import Callout from "@/ui/Callout";
import { DocLink } from "@/components/DocLink";
import DataSourceTypeSelector from "@/components/Settings/DataSourceTypeSelector";
import { isCloud } from "@/services/env";
import { useUser } from "@/services/UserContext";
import ManagedWarehouseModal from "@/components/InitialSetup/ManagedWarehouseModal";
import Badge from "@/ui/Badge";
import EventSourceList from "./EventSourceList";
import ConnectionSettings from "./ConnectionSettings";

type Step =
  | "initial"
  | "eventTracker"
  | "connection"
  | "schemaOptions"
  | "done";

const schemasMap = new Map(eventSchemas.map((o) => [o.value, o]));

const NewDataSourceForm: FC<{
  initial?: Partial<DataSourceInterfaceWithParams>;
  source: string;
  onCancel?: () => void;
  onSuccess: (id: string) => Promise<void>;
  showImportSampleData: boolean;
  inline?: boolean;
  showBackButton?: boolean;
}> = ({
  initial,
  onSuccess,
  onCancel,
  source,
  inline,
  showBackButton = true,
}) => {
  const {
    datasources,
    projects: allProjects,
    project,
    mutateDefinitions,
  } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const { apiCall, orgId } = useAuth();
  const { hasCommercialFeature, license } = useUser();
  const gb = useGrowthBook();

  const settings = useOrgSettings();
  const { metricDefaults } = useOrganizationMetricDefaults();

  useEffect(() => {
    track("View Datasource Form", {
      source,
      newDatasourceForm: true,
    });
  }, [source]);

  const [step, setStep] = useState<Step>("initial");

  // Form data for the event tracker screen
  const [eventTracker, setEventTracker] = useState<SchemaFormat | "">("");

  // Form data for the main connection screen
  const [connectionInfo, setConnectionInfo] = useState<
    Partial<DataSourceInterfaceWithParams>
  >({
    name: "My Datasource",
    settings: {},
    projects: project ? [project] : [],
    ...initial,
  });

  // Cloud, no managed warehouse yet, and is either free OR on a usage-based paid plan
  const showManagedWarehouse =
    isCloud() &&
    !datasources.some((d) => d.type === "growthbook_clickhouse") &&
    (!hasCommercialFeature("managed-warehouse") ||
      !!license?.orbSubscription) &&
    gb.isOn("inbuilt-data-warehouse");
  const [managedWarehouseOpen, setManagedWarehouseOpen] = useState(false);

  // Form data for the schema options screen
  const schemaOptionsForm = useForm<Record<string, string | number>>({
    defaultValues: {},
  });

  // Progress for the resource creation screen (final screen)
  const [resourceProgress, setResourceProgress] = useState(0);
  const [creatingResources, setCreatingResources] = useState(false);

  // Holds the final data source object
  const [createdDatasource, setCreatedDatasource] =
    useState<DataSourceInterfaceWithParams | null>(null);

  const possibleSchemas = eventSchemas
    .filter(
      (s) => connectionInfo.type && s.types?.includes(connectionInfo.type),
    )
    .map((s) => s.value);

  const [lastError, setLastError] = useState("");

  const setSchemaSettings = useCallback(
    (s: eventSchema) => {
      setEventTracker(s.value);
      track("Selected Event Schema", {
        schema: s.value,
        source,
        newDatasourceForm: true,
      });

      setConnectionInfo((connectionInfo) => ({
        ...connectionInfo,
        settings: {
          schemaFormat: s.value,
        },
      }));

      if (s.options) {
        s.options.forEach((o) => {
          schemaOptionsForm.setValue(o.name, o.defaultValue || "");
        });
      } else {
        schemaOptionsForm.reset({});
      }
    },
    [schemaOptionsForm, source],
  );

  useEffect(() => {
    if (initial?.type) {
      if (
        initial.type !== "mixpanel" &&
        eventSchemas.some(
          (s) => initial.type && s.types?.includes(initial.type),
        )
      ) {
        setStep("eventTracker");
      } else {
        setStep("connection");
      }
    }
  }, [initial?.type]);

  const selectedSchema: eventSchema = schemasMap.get(
    eventTracker || "custom",
  ) || {
    label: "Custom",
    value: "custom",
  };

  // Filter out demo datasource from available projects
  const projects = allProjects.filter(
    (p) =>
      !isDemoDatasourceProject({
        projectId: p.id,
        organizationId: orgId || "",
      }),
  );
  const projectOptions = useProjectOptions(
    (project) =>
      permissionsUtil.canCreateDataSource({
        projects: [project],
        type: undefined,
      }),
    [],
  );

  let ctaEnabled = true;
  let disabledMessage: string | null = null;
  if (!permissionsUtil.canViewCreateDataSourceModal(project)) {
    ctaEnabled = false;
    disabledMessage = "You don't have permission to create data sources.";
  }

  const saveConnectionInfo =
    async (): Promise<DataSourceInterfaceWithParams> => {
      setLastError("");

      try {
        if (!connectionInfo.type || !connectionInfo.params) {
          throw new Error("Please select a data source type");
        }

        if (connectionInfo.settings && eventTracker) {
          connectionInfo.settings.schemaFormat = eventTracker;
        }

        // Update
        // Used if someone goes back to this step after already submitting
        if (createdDatasource) {
          const res = await apiCall<{
            datasource: DataSourceInterfaceWithParams;
          }>(`/datasource/${createdDatasource.id}`, {
            method: "PUT",
            body: JSON.stringify({
              ...connectionInfo,
            }),
          });
          track("Updating Datasource Form", {
            source,
            type: connectionInfo.type,
            schema: eventTracker,
            newDatasourceForm: true,
          });

          setCreatedDatasource(res.datasource);
          return res.datasource;
        }
        // Create
        else {
          const data: Partial<DataSourceInterfaceWithParams> = {
            ...connectionInfo,
            settings: {
              ...getInitialSettings(
                selectedSchema.value,
                connectionInfo.params,
                {},
              ),
              ...(connectionInfo.settings || {}),
            },
          };
          const res = await apiCall<{
            datasource: DataSourceInterfaceWithParams;
          }>(`/datasources`, {
            method: "POST",
            body: JSON.stringify(data),
          });
          track("Submit Datasource Form", {
            source,
            type: connectionInfo.type,
            schema: eventTracker,
            newDatasourceForm: true,
          });

          setCreatedDatasource(res.datasource);
          return res.datasource;
        }
      } catch (e) {
        track("Data Source Form Error", {
          source,
          type: connectionInfo.type,
          error: e.message.substr(0, 32) + "...",
          newDatasourceForm: true,
        });
        setLastError(e.message);
        throw e;
      }
    };

  const saveSchemaOptions = async (values: Record<string, string | number>) => {
    if (!createdDatasource) {
      throw new Error("No data source created yet");
    }

    // Re-generate settings with the entered schema options
    const settings = getInitialSettings(
      selectedSchema.value,
      createdDatasource.params,
      values,
    );

    const updates: Pick<DataSourceInterfaceWithParams, "settings"> = {
      settings: {
        ...settings,
        schemaOptions: values,
      },
    };

    const res = await apiCall<{ datasource: DataSourceInterfaceWithParams }>(
      `/datasource/${createdDatasource.id}`,
      {
        method: "PUT",
        body: JSON.stringify(updates),
      },
    );
    track("Saving Datasource Query Settings", {
      source,
      type: createdDatasource.type,
      schema: createdDatasource.settings?.schemaFormat,
      newDatasourceForm: true,
    });

    setCreatedDatasource(res.datasource);
  };

  const onChange: ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement> = (
    e,
  ) => {
    setConnectionInfo({
      ...connectionInfo,
      [e.target.name]: e.target.value,
    });
  };
  const onManualChange = (name: keyof DataSourceInterfaceWithParams, value) => {
    setConnectionInfo({
      ...connectionInfo,
      [name]: value,
    });
  };

  const createResources = (ds: DataSourceInterfaceWithParams) => {
    if (!ds) {
      return;
    }

    const resources = getInitialDatasourceResources({ datasource: ds });
    if (!resources.factTables.length) {
      setCreatingResources(false);
      return;
    }

    setCreatingResources(true);
    createInitialResources({
      datasource: ds,
      onProgress: (progress) => {
        setResourceProgress(progress);
      },
      apiCall,
      metricDefaults,
      settings,
      resources,
    })
      .then(() => {
        track("Creating Datasource Resources", {
          source,
          type: ds.type,
          schema: ds.settings?.schemaFormat,
          newDatasourceForm: true,
        });
      })
      .catch((e) => {
        console.error(e);
      })
      .finally(() => {
        mutateDefinitions();
        setCreatingResources(false);
      });
  };

  const submit =
    step === "initial"
      ? async () => {
          if (connectionInfo.type === "mixpanel") {
            setStep("connection");
          } else if (possibleSchemas.length > 0) {
            setStep("eventTracker");
          } else {
            setStep("connection");
          }
        }
      : step === "eventTracker"
        ? async () => {
            setStep("connection");
          }
        : step === "connection"
          ? async () => {
              const ds = await saveConnectionInfo();
              mutateDefinitions();

              // If the selected schema supports options, go to that step
              // Otherwise, skip to end
              if (selectedSchema.options) {
                setStep("schemaOptions");
              } else {
                createResources(ds);
                setStep("done");
              }
            }
          : step === "schemaOptions"
            ? schemaOptionsForm.handleSubmit(async (values) => {
                await saveSchemaOptions(values);
                createdDatasource && createResources(createdDatasource);
                setStep("done");
              })
            : async () => {
                // Done
                await onSuccess(createdDatasource?.id || "");
                onCancel && onCancel();
              };

  let stepContents: ReactNode = null;
  if (step === "initial") {
    stepContents = (
      <div>
        <p className="mb-4">
          GrowthBook is <strong>Warehouse Native</strong>, which means we can
          sit on top of any SQL data without storing our own copy.
        </p>
        <div>
          <label>Where do you store your analytics data?</label>

          <DataSourceTypeSelector
            value={connectionInfo.type || ""}
            setValue={(value) => {
              const option = dataSourceConnections.find(
                (o) => o.type === value,
              );
              if (!option) return;

              setLastError("");

              track("Data Source Type Selected", {
                type: value,
                newDatasourceForm: true,
              });

              setConnectionInfo({
                ...connectionInfo,
                type: option.type,
                params: option.default,
              } as Partial<DataSourceInterfaceWithParams>);

              if (
                option.type !== "mixpanel" &&
                eventSchemas.some((s) => s.types?.includes(option.type))
              ) {
                setStep("eventTracker");
              } else {
                setStep("connection");
              }
            }}
          />
          {showManagedWarehouse ? (
            <Callout status="info" mt="3" icon={null}>
              <Badge label="New!" color="violet" variant="solid" mr="3" />
              <Text mr="3">
                GrowthBook Cloud now offers a fully managed data warehouse
                option.
              </Text>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setManagedWarehouseOpen(true);
                }}
              >
                Try it now
              </a>
            </Callout>
          ) : (
            <Callout status="info" mt="3">
              Don&apos;t have a data warehouse yet? We recommend using BigQuery
              with Google Analytics.{" "}
              <DocLink docSection="ga4BigQuery">
                Learn more <FaExternalLinkAlt />
              </DocLink>
            </Callout>
          )}
        </div>
      </div>
    );
  } else if (step === "eventTracker") {
    stepContents = (
      <div>
        <div className="mb-3">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setLastError("");
              setStep("initial");
            }}
          >
            <span style={{ position: "relative", top: "-1px" }}>
              <GBCircleArrowLeft />
            </span>{" "}
            Back
          </a>
        </div>
        {connectionInfo.type ? (
          <h3>
            {dataSourceConnections.find((d) => d.type === connectionInfo.type)
              ?.display || connectionInfo.type}
          </h3>
        ) : (
          <h3>Select Your Event Tracker</h3>
        )}
        <p>
          We can pre-populate SQL for a number of common event trackers.
          Don&apos;t see yours listed? Choose &quot;Custom&quot; to configure it
          manually.
        </p>
        <EventSourceList
          onSelect={(s) => {
            setSchemaSettings(s);
            setStep("connection");
          }}
          selected={connectionInfo.settings?.schemaFormat}
          allowedSchemas={connectionInfo.type ? possibleSchemas : undefined}
        />
      </div>
    );
  } else if (step === "connection") {
    const datasourceInfo = dataSourceConnections.find(
      (d) => d.type === connectionInfo.type,
    );

    const headerParts: string[] = [
      datasourceInfo?.display || connectionInfo.type || "",
    ];
    if (connectionInfo.type !== "mixpanel") {
      headerParts.push(selectedSchema.label);
    }

    stepContents = (
      <div>
        <div className="mb-3">
          {showBackButton && (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setLastError("");
                if (connectionInfo.type === "mixpanel") {
                  setStep("initial");
                } else {
                  setStep("eventTracker");
                }
              }}
            >
              <span style={{ position: "relative", top: "-1px" }}>
                <GBCircleArrowLeft />
              </span>{" "}
              Back
            </a>
          )}
        </div>
        <h3>{headerParts.join(" > ")}</h3>

        {datasourceInfo ? (
          <Callout status="info" mb="3">
            View docs on connecting{" "}
            {selectedSchema.helpLink ? (
              <>
                <a
                  href={selectedSchema.helpLink}
                  target="_blank"
                  rel="noreferrer"
                >
                  {selectedSchema.label} to {datasourceInfo.display}{" "}
                  <FaExternalLinkAlt />
                </a>{" "}
                or{" "}
              </>
            ) : null}
            <DocLink docSection={datasourceInfo.docs}>
              {datasourceInfo.display} to GrowthBook <FaExternalLinkAlt />
            </DocLink>{" "}
          </Callout>
        ) : null}

        <div className="form-group">
          <label>Name</label>
          <input
            type="text"
            className="form-control"
            name="name"
            required
            onChange={onChange}
            value={connectionInfo.name}
            autoFocus={true}
          />
        </div>
        <div className="form-group">
          <label>Description</label>
          <textarea
            className="form-control"
            name="description"
            onChange={onChange}
            value={connectionInfo.description}
          />
        </div>
        {projects?.length > 0 && (
          <div className="form-group">
            <MultiSelectField
              label={
                <>
                  Projects{" "}
                  <Tooltip
                    body={`The dropdown below has been filtered to only include projects where you have permission to create Data Sources.`}
                  />
                </>
              }
              placeholder="All projects"
              value={connectionInfo.projects || []}
              options={projectOptions}
              onChange={(v) => onManualChange("projects", v)}
              customClassName="label-overflow-ellipsis"
              helpText="Assign this data source to specific projects"
            />
          </div>
        )}
        <ConnectionSettings
          datasource={connectionInfo}
          existing={false}
          hasError={!!lastError}
          setDatasource={setConnectionInfo}
        />
      </div>
    );
  } else if (step === "schemaOptions") {
    stepContents = (
      <div>
        <div className="mb-2">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setStep("connection");
            }}
          >
            <span style={{ position: "relative", top: "-1px" }}>
              <GBCircleArrowLeft />
            </span>{" "}
            Back
          </a>
        </div>
        <h3>{selectedSchema.label || ""} Query Options</h3>
        <div className="my-4">
          <div className="d-inline-block">
            Below are are the typical defaults for{" "}
            {selectedSchema.label || "this data source"}.{" "}
            {selectedSchema.options?.length === 1
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
                value={schemaOptionsForm.watch(name)}
                type={type}
                onChange={(e) => {
                  schemaOptionsForm.setValue(name, e.target.value);
                }}
                helpText={helpText}
              />
            </div>
          ))}
        </div>
      </div>
    );
  } else if (step === "done") {
    stepContents = (
      <div>
        <Callout status="success" mb="3">
          Connection successful!
        </Callout>

        {creatingResources ? (
          <div>
            <p>Hang tight while we create some metrics to get you started.</p>
            <div className="progress">
              <div
                className="progress-bar"
                role="progressbar"
                style={{ width: `${Math.floor(resourceProgress * 100)}%` }}
                aria-valuenow={resourceProgress}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
          </div>
        ) : resourceProgress > 0 ? (
          <div>
            <p>All done! Now you&apos;re ready to start experimenting.</p>
          </div>
        ) : (
          <div>
            <p>
              Now you&apos;re ready to create metrics and start experimenting.
            </p>
          </div>
        )}
      </div>
    );

    if (creatingResources) {
      ctaEnabled = false;
    }
  }

  // Disabling the CTA if the user hasn't input a data set to call attention to the "Test Connection" button
  if (
    step == "connection" &&
    connectionInfo.type === "bigquery" &&
    !connectionInfo.params?.defaultDataset
  ) {
    ctaEnabled = false;
  }

  if (step === "initial" && !connectionInfo.type) {
    ctaEnabled = false;
  }

  if (managedWarehouseOpen) {
    return (
      <ManagedWarehouseModal close={() => setManagedWarehouseOpen(false)} />
    );
  }

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      header={"Add Data Source"}
      close={onCancel}
      disabledMessage={disabledMessage || undefined}
      ctaEnabled={ctaEnabled}
      submit={submit}
      autoCloseOnSubmit={false}
      cta={step === "done" ? "Finish" : "Next"}
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
