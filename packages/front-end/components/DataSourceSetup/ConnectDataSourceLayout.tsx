import {
  ChangeEventHandler,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
import {
  PiArrowClockwise,
  PiCheckBold,
  PiQuestion,
  PiXBold,
} from "react-icons/pi";
import isEqual from "lodash/isEqual";
import {
  DataSourceInterfaceWithParams,
  DataSourceType,
  SchemaFormat,
} from "shared/types/datasource";
import { EventForwarderSinkType } from "shared/types/event-forwarder";
import {
  EventForwarderWarehouseArea,
  EventForwarderWarehouseRegion,
  getGrowthBookRegionForWarehouseRegion,
  listEventForwarderWarehouseRegions,
} from "shared/util";
import { isSampleDatasource } from "shared/demo-datasource";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import { isTestableDataSourceType } from "shared/validators";
import ConnectionSettings from "@/components/Settings/ConnectionSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useProjectOptions from "@/hooks/useProjectOptions";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  DataRegion,
  DEFAULT_DATA_REGION,
  useDataRegionOptions,
} from "@/services/dataRegions";
import { dataSourceConnections } from "@/services/eventSchema";
import track from "@/services/track";
import Avatar from "@/ui/Avatar";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/ui/MultiSelectField";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import Tooltip from "@/ui/Tooltip";
import { useEventForwarderAccessTest } from "@/components/Settings/useEventForwarderAccessTest";
import { KeyPairGenerator } from "@/components/Settings/SnowflakeForm";
import { buildEventForwarderConnectDraft } from "./buildEventForwarderConnectDraft";
import DataSourceConnectInstructions, {
  ConnectSetupKind,
} from "./DataSourceConnectInstructions";
import EventForwarderDestinationFields, {
  defaultEventForwarderDestination,
  eventDestinationEntryHint,
  eventDestinationWithConnectionSchema,
  eventForwarderDestinationFromDatasource,
} from "./EventForwarderDestinationFields";
import {
  generateSnowflakeKeyPair,
  SnowflakeKeyPair,
} from "./generateSnowflakeKeyPair";
import { hasConnectionTestInputs } from "./hasConnectionTestInputs";
import { overallTestStatus, TestStatus } from "./overallTestStatus";

function isEventForwarderSink(
  type: DataSourceType | undefined,
): type is EventForwarderSinkType {
  return type === "bigquery" || type === "snowflake" || type === "databricks";
}

function ingestorForRegion(region: DataRegion): string {
  return region === "eu-west-1" ? "EU ingestor" : "US ingestor";
}

function warehouseRegionHelp(sinkType: EventForwarderSinkType): string {
  switch (sinkType) {
    case "bigquery":
      return "Open the dataset in the BigQuery console. Location is under Dataset info.";
    case "snowflake":
      return "The region is in your Snowflake account URL, or run SELECT CURRENT_REGION().";
    case "databricks":
      return "Open Workspaces in the Databricks account console. The region is listed for your workspace.";
  }
}

const DATA_SOURCE_TYPE_ABBR: Record<DataSourceType, string> = {
  bigquery: "BQ",
  snowflake: "SF",
  databricks: "DB",
  redshift: "RS",
  athena: "AT",
  presto: "PT",
  clickhouse: "CH",
  postgres: "PG",
  mysql: "MY",
  vertica: "VE",
  mssql: "MS",
  adobe_experience_platform_query_service: "AE",
  mixpanel: "MP",
  google_analytics: "GA",
  growthbook_clickhouse: "GB",
};

export type ConnectDataSourceLayoutProps = {
  mode: "create" | "edit";
  initial: Partial<DataSourceInterfaceWithParams>;
  setup?: ConnectSetupKind;
  schemaFormat?: SchemaFormat;
  // The processing region chosen in Event Forwarder setup. Edit mode reads
  // the saved config instead.
  eventForwarderRegion?: DataRegion | null;
  source: string;
  onCancel: () => void;
  onSuccess: (id: string) => Promise<void>;
};

export default function ConnectDataSourceLayout({
  mode,
  initial,
  setup = "custom",
  schemaFormat = "custom",
  eventForwarderRegion: eventForwarderRegionOverride = null,
  source,
  onCancel,
  onSuccess,
}: ConnectDataSourceLayoutProps) {
  const existing = mode === "edit";
  // Destination and region are chosen once, at create. Edit changes credentials.
  const checksWrite = !existing && setup === "event_forwarder";
  const { mutateDefinitions, projects: orgProjects } = useDefinitions();
  const { apiCall, orgId } = useAuth();
  const permissionsUtil = usePermissionsUtil();

  const [datasource, setDatasource] =
    useState<Partial<DataSourceInterfaceWithParams>>(initial);
  const [dirty, setDirty] = useState(false);
  const [paramsDirty, setParamsDirty] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [readStatus, setReadStatus] = useState<TestStatus>("idle");
  const [writeStatus, setWriteStatus] = useState<TestStatus>("idle");
  const [readMessage, setReadMessage] = useState<string | null>(null);
  const [writeMessage, setWriteMessage] = useState<string | null>(null);
  const [eventDestinationDraft, setEventDestination] = useState(() =>
    defaultEventForwarderDestination(initial.type || "bigquery"),
  );
  // Set once the user types in the destination location, so a later schema
  // change does not replace what they entered.
  const [destinationLocationEdited, setDestinationLocationEdited] =
    useState(false);
  const snowflakeSchema =
    datasource.type === "snowflake"
      ? ((datasource.params as Partial<SnowflakeConnectionParams> | undefined)
          ?.schema ?? "")
      : null;
  const eventDestination = eventDestinationWithConnectionSchema(
    eventDestinationDraft,
    snowflakeSchema,
    destinationLocationEdited,
  );
  const [saving, setSaving] = useState(false);
  const [resolvedRegion, setResolvedRegion] = useState<DataRegion | null>(null);
  const [regionChoiceRequired, setRegionChoiceRequired] = useState(false);
  const [regionBlockedMessage, setRegionBlockedMessage] = useState<
    string | null
  >(null);
  const [detectedWarehouseRegionId, setDetectedWarehouseRegionId] = useState<
    string | null
  >(null);
  const [manualWarehouseRegionId, setManualWarehouseRegionId] = useState("");
  const [detectingRegion, setDetectingRegion] = useState(false);
  const dataRegionOptions = useDataRegionOptions();
  // Incremented whenever the connection a test would cover changes, so an
  // earlier response cannot approve what it never saw.
  const testRunRef = useRef(0);
  const saveErrorRef = useRef<HTMLDivElement>(null);

  const clearDetectedRegion = () => {
    setResolvedRegion(null);
    setRegionChoiceRequired(false);
    setRegionBlockedMessage(null);
    setDetectedWarehouseRegionId(null);
    setManualWarehouseRegionId("");
    setDetectingRegion(false);
  };

  const resetTest = useCallback(() => {
    testRunRef.current += 1;
    setReadStatus("idle");
    setWriteStatus("idle");
    setReadMessage(null);
    setWriteMessage(null);
    setResolvedRegion(null);
    setRegionChoiceRequired(false);
    setRegionBlockedMessage(null);
    setDetectedWarehouseRegionId(null);
    setManualWarehouseRegionId("");
    setDetectingRegion(false);
  }, []);

  // Saved Event Forwarder configs predating the region field are us-east-1.
  const savedEventForwarderRegion =
    eventForwarderRegionOverride ??
    (initial.eventForwarderConfig
      ? (initial.eventForwarderConfig.region ?? DEFAULT_DATA_REGION)
      : null);
  const eventForwarderRegion = checksWrite
    ? resolvedRegion
    : savedEventForwarderRegion;
  const sinkType = isEventForwarderSink(datasource.type)
    ? datasource.type
    : null;
  const allowedRegions = useMemo(
    () => new Set(dataRegionOptions.map((option) => option.value)),
    [dataRegionOptions],
  );
  const warehouseRegions = useMemo(() => {
    if (!sinkType) return [];
    return listEventForwarderWarehouseRegions(sinkType).filter((region) =>
      allowedRegions.has(region.growthBookRegion),
    );
  }, [sinkType, allowedRegions]);
  const regionsByArea = useMemo(() => {
    const groups: {
      area: EventForwarderWarehouseArea;
      regions: EventForwarderWarehouseRegion[];
    }[] = [];
    for (const region of warehouseRegions) {
      const group = groups.find((item) => item.area === region.area);
      if (group) {
        group.regions.push(region);
      } else {
        groups.push({ area: region.area, regions: [region] });
      }
    }
    return groups;
  }, [warehouseRegions]);
  const regionOptions = useMemo(
    () =>
      regionsByArea.map((group) => ({
        label: group.area,
        options: group.regions.map((region) => ({
          value: region.id,
          label: `${region.cloud} ${region.label}${
            region.id === detectedWarehouseRegionId ? " (detected)" : ""
          }`,
        })),
      })),
    [regionsByArea, detectedWarehouseRegionId],
  );

  const chooseManualRegion = (id: string) => {
    setManualWarehouseRegionId(id);
    setRegionBlockedMessage(null);
    if (!sinkType) {
      setResolvedRegion(null);
      return;
    }
    const mapped = getGrowthBookRegionForWarehouseRegion(sinkType, id);
    setResolvedRegion(mapped && allowedRegions.has(mapped) ? mapped : null);
  };

  useEffect(() => {
    track("View Datasource Connect Page", {
      source,
      mode,
      type: initial.type,
      setup,
    });
  }, [source, mode, initial.type, setup]);

  useEffect(() => {
    if (!saveError) return;
    saveErrorRef.current?.scrollIntoView({ block: "nearest" });
  }, [saveError]);

  useEffect(() => {
    if (!dirty) {
      setDatasource(initial);
      setEventDestination(
        defaultEventForwarderDestination(initial.type || "bigquery"),
      );
      setDestinationLocationEdited(false);
      setParamsDirty(false);
      resetTest();
    }
  }, [initial, dirty, resetTest]);

  const typeInfo = useMemo(
    () => dataSourceConnections.find((c) => c.type === datasource.type),
    [datasource.type],
  );

  const isSampleData = isSampleDatasource({
    datasourceId: initial.id,
    type: initial.type,
    host:
      initial.params && "host" in initial.params
        ? initial.params.host
        : undefined,
    projects: initial.projects,
    organizationId: orgId ?? undefined,
  });

  const updateDatasource = useCallback(
    (next: Partial<DataSourceInterfaceWithParams>) => {
      setDatasource(next);
      setDirty(true);
      // ConnectionSettings rebuilds `params` on every change, including
      // advanced settings, so compare by value. Only real connection changes
      // should invalidate the test and trigger a server-side re-test on save.
      if (!isEqual(next.params, datasource.params)) {
        setParamsDirty(true);
        resetTest();
      }
    },
    [datasource.params, resetTest],
  );

  const onChange: ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement> = (
    e,
  ) => {
    updateDatasource({
      ...datasource,
      [e.target.name]: e.target.value,
    });
  };

  // Snowflake key pair created on request. Lives here rather than in the
  // page so the form (private key) and the instructions (public key) agree,
  // and so the edit page can offer it when moving off password auth.
  const [snowflakeKeyPair, setSnowflakeKeyPair] =
    useState<SnowflakeKeyPair | null>(null);
  const usingGeneratedKey =
    snowflakeKeyPair !== null &&
    datasource.params !== undefined &&
    "privateKey" in datasource.params &&
    datasource.params.privateKey === snowflakeKeyPair.privateKey;
  const generateKeyPair = useCallback(async () => {
    const keyPair = await generateSnowflakeKeyPair();
    if (!keyPair) return false;
    setSnowflakeKeyPair(keyPair);
    // The generated key is unencrypted, so drop any passphrase left over
    // from an uploaded file.
    updateDatasource({
      ...datasource,
      params: {
        ...datasource.params,
        privateKey: keyPair.privateKey,
        privateKeyPassword: "",
      },
    } as Partial<DataSourceInterfaceWithParams>);
    return true;
  }, [datasource, updateDatasource]);
  const keyPairGenerator = useMemo(
    (): KeyPairGenerator | undefined =>
      datasource.type === "snowflake"
        ? {
            usingGenerated: usingGeneratedKey,
            generate: generateKeyPair,
            keyPairRequired: setup === "event_forwarder",
          }
        : undefined,
    [datasource.type, usingGeneratedKey, generateKeyPair, setup],
  );
  // Create mode only: let the user scope the new Data Source to Projects they
  // can create in. An empty selection is All Projects, which needs a global role.
  const projectOptions = useProjectOptions(
    (project) =>
      permissionsUtil.canCreateDataSource({
        projects: [project],
        type: datasource.type,
      }),
    [],
  );
  const showProjectPicker = !existing && orgProjects.length > 0;
  const projectPermissionError =
    !existing &&
    !permissionsUtil.canCreateDataSource({
      projects: datasource.projects,
      type: datasource.type,
    })
      ? "You don't have permission to create a Data Source for All Projects. Select a Project."
      : null;

  const canTest =
    !!datasource.type &&
    isTestableDataSourceType(datasource.type) &&
    !isSampleData;
  const connectionDetailsReady = hasConnectionTestInputs(
    datasource.type,
    datasource.params,
    existing && !datasource.decryptionError,
  );
  const destinationReady =
    !checksWrite ||
    (!!eventDestination.location.trim() &&
      !!eventDestination.tablePrefix.trim() &&
      (datasource.type !== "databricks" ||
        !!eventDestination.zerobusEndpoint.trim()));
  const connectionInputsReady = connectionDetailsReady && destinationReady;
  const missingTestInputsHint = !connectionDetailsReady
    ? "Enter the connection details to test."
    : !destinationReady
      ? eventDestinationEntryHint(datasource.type, "test")
      : "";
  const eventForwarderDraft =
    checksWrite && datasource.type
      ? buildEventForwarderConnectDraft({
          type: datasource.type,
          params: datasource.params,
          destination: eventDestination,
          region: eventForwarderRegion,
        })
      : null;
  // The setup instructions' write-access grants must target the destination
  // the user actually chose: the live form value while it's still editable,
  // or the already-saved one once editing is restricted to credentials only.
  const instructionsEventDestination = checksWrite
    ? eventDestination
    : setup === "event_forwarder"
      ? eventForwarderDestinationFromDatasource(initial)
      : null;
  const { testEventForwarderAccess } = useEventForwarderAccessTest({
    existing: false,
    type: eventForwarderDraft?.sinkType ?? "bigquery",
    params: datasource.params,
    projects: datasource.projects,
    eventForwarderConfig: eventForwarderDraft,
  });
  const testStatus = overallTestStatus(readStatus, writeStatus, checksWrite);
  const updateEventDestination = (patch: Partial<typeof eventDestination>) => {
    if (patch.location !== undefined) setDestinationLocationEdited(true);
    setEventDestination((current) => ({ ...current, ...patch }));
    setDirty(true);
    resetTest();
  };

  const runTest = async () => {
    if (
      !canTest ||
      !connectionInputsReady ||
      !datasource.type ||
      !isTestableDataSourceType(datasource.type)
    ) {
      return;
    }
    const runId = (testRunRef.current += 1);
    setReadStatus("running");
    setWriteStatus("idle");
    setReadMessage(null);
    setWriteMessage(null);
    setHasError(false);
    clearDetectedRegion();

    const fail = (message: string, access: "read" | "write") => {
      if (runId !== testRunRef.current) return;
      if (access === "read") {
        setReadStatus("failed");
        setReadMessage(message);
      } else {
        setWriteStatus("failed");
        setWriteMessage(message);
      }
      setHasError(true);
      track("Data Source Connection Test Failed", {
        source,
        mode,
        type: datasource.type,
        error: message.slice(0, 32),
      });
    };

    try {
      const res = await apiCall<{ status: number; message?: string }>(
        "/datasources/test-connection",
        {
          method: "POST",
          body: JSON.stringify({
            type: datasource.type,
            params: datasource.params || {},
            projects: datasource.projects,
            ...(existing && datasource.id
              ? { datasourceId: datasource.id }
              : {}),
          }),
        },
      );
      if (res.status > 200) {
        throw new Error(res.message || "Unable to connect to the Data Source");
      }
      // Params changed while this test was in flight; its result is stale.
      if (runId !== testRunRef.current) return;
      setReadStatus("passed");
    } catch (e) {
      fail(
        e instanceof Error ? e.message : "Unable to connect to the Data Source",
        "read",
      );
      return;
    }

    if (!checksWrite) {
      track("Data Source Connection Test Passed", {
        source,
        mode,
        type: datasource.type,
      });
      return;
    }

    setWriteStatus("running");
    try {
      if (!eventForwarderDraft) {
        throw new Error(
          "Enter the event destination before testing write access.",
        );
      }
      await testEventForwarderAccess();
      if (runId !== testRunRef.current) return;
      setDetectingRegion(true);
      try {
        const detected = await apiCall<{
          status: number;
          warehouseRegionId: string | null;
          growthBookRegion: DataRegion | null;
        }>("/datasources/event-forwarder/detect-region", {
          method: "POST",
          body: JSON.stringify({
            type: datasource.type,
            params: datasource.params || {},
            projects: datasource.projects,
            location: eventDestination.location,
            zerobusEndpoint: eventDestination.zerobusEndpoint,
          }),
        });
        if (runId !== testRunRef.current) return;
        setDetectedWarehouseRegionId(detected.warehouseRegionId);
        setRegionChoiceRequired(true);
        const allowed = new Set(
          dataRegionOptions.map((option) => option.value),
        );
        if (
          detected.growthBookRegion &&
          allowed.has(detected.growthBookRegion)
        ) {
          setManualWarehouseRegionId(detected.warehouseRegionId ?? "");
          setResolvedRegion(detected.growthBookRegion);
        } else if (detected.growthBookRegion) {
          setRegionBlockedMessage(
            `This warehouse is in ${detected.warehouseRegionId}, which routes to GrowthBook's ${ingestorForRegion(detected.growthBookRegion)}. That ingestor is not enabled for this organization.`,
          );
        } else {
          setManualWarehouseRegionId("");
        }
      } catch {
        if (runId !== testRunRef.current) return;
        setRegionChoiceRequired(true);
      } finally {
        if (runId === testRunRef.current) setDetectingRegion(false);
      }
      setWriteStatus("passed");
      track("Data Source Connection Test Passed", {
        source,
        mode,
        type: datasource.type,
      });
    } catch (e) {
      fail(
        e instanceof Error ? e.message : "Unable to confirm write access",
        "write",
      );
    }
  };

  const needsSuccessfulTest = (!existing || paramsDirty) && canTest;
  // Region is stored once at create. A missing value must not fall back to
  // us-east-1, because it cannot be changed later.
  const needsEventForwarderRegion =
    !existing && setup === "event_forwarder" && !eventForwarderRegion;
  const canSave =
    !isSampleData &&
    !!datasource.name?.trim() &&
    !!datasource.type &&
    projectPermissionError === null &&
    !needsEventForwarderRegion &&
    (!checksWrite || !!eventForwarderDraft) &&
    (!needsSuccessfulTest || testStatus === "passed") &&
    (existing ? dirty : true);

  const saveHint = (() => {
    if (isSampleData) {
      return "You cannot edit the sample Data Source connection.";
    }
    if (!datasource.name?.trim()) {
      return "Enter a Data Source name to continue";
    }
    if (projectPermissionError !== null) {
      return "Select a Project to continue";
    }
    if (regionBlockedMessage) {
      return "The EU ingestor is not enabled for this organization";
    }
    if (needsSuccessfulTest && !connectionInputsReady) {
      return missingTestInputsHint;
    }
    if (needsSuccessfulTest && testStatus === "idle") {
      return "Test the connection to continue";
    }
    if (writeStatus === "running" || detectingRegion) {
      return detectingRegion
        ? "Finding the warehouse region"
        : "Checking write access";
    }
    if (testStatus === "running") {
      return "Testing connection";
    }
    if (testStatus === "failed") {
      return "Fix the connection to continue";
    }
    if (needsEventForwarderRegion) {
      return "Choose a warehouse region to continue";
    }
    if (existing && !dirty) {
      return "No changes to save";
    }
    return "";
  })();

  const handleSave = async () => {
    if (!canSave || !datasource.type) return;
    setSaving(true);
    setSaveError(null);
    setHasError(false);

    try {
      let id = datasource.id;

      if (existing && id) {
        // Only send what this page edits. Description and Projects are edited
        // on the Data Source page, and sending stale copies would overwrite
        // changes made there while this form was open. Params only go up when
        // touched, since the server re-tests the connection whenever present.
        const putBody: {
          name?: string;
          params?: DataSourceInterfaceWithParams["params"];
          settings?: DataSourceInterfaceWithParams["settings"];
        } = {
          name: datasource.name,
        };
        if (paramsDirty) {
          putBody.params = datasource.params;
        }
        if (!isEqual(datasource.settings, initial.settings)) {
          putBody.settings = datasource.settings;
        }
        const res = await apiCall<{ status: number; message: string }>(
          `/datasource/${id}`,
          {
            method: "PUT",
            body: JSON.stringify(putBody),
          },
        );
        if (res.status > 200) {
          throw new Error(res.message);
        }
        track("Submit Datasource Connect Form", {
          source,
          mode: "edit",
          type: datasource.type,
          setup,
        });
      } else {
        // Create always starts from empty settings. The connect form never
        // collects them, so there is nothing to merge with a seeded template.
        // Identifier types and exposure queries stay empty until Finish
        // Setting Up writes them.
        const res = await apiCall<{ id: string }>("/datasources", {
          method: "POST",
          body: JSON.stringify({
            ...datasource,
            settings: {
              schemaFormat,
              userIdTypes: [],
              queries: { exposure: [] },
            },
            ...(eventForwarderDraft
              ? { eventForwarderConfig: eventForwarderDraft }
              : {}),
          }),
        });
        id = res.id;
        track("Submit Datasource Connect Form", {
          source,
          mode: "create",
          type: datasource.type,
          setup,
        });
      }

      if (!id) {
        throw new Error("Data Source was not saved");
      }

      setDirty(false);
      setParamsDirty(false);
      await mutateDefinitions({});
      await onSuccess(id);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Failed to save the Data Source";
      setSaveError(message);
      setHasError(true);
      track("Data Source Connect Form Error", {
        source,
        mode,
        type: datasource.type,
        error: message.slice(0, 32),
      });
    } finally {
      setSaving(false);
    }
  };

  if (!datasource.type || !typeInfo) {
    return (
      <Callout status="error">
        Choose a supported Data Source type to continue.
      </Callout>
    );
  }

  const type = datasource.type as DataSourceType;
  const readAccessTarget = datasource.name?.trim() || typeInfo.display;
  const testBorderColor =
    testStatus === "failed"
      ? "var(--red-7)"
      : testStatus === "passed"
        ? "var(--green-7)"
        : "var(--gray-a5)";

  return (
    <Grid
      // From lg up the form and instructions sit side by side and scroll
      // independently, so the grid is locked to the viewport below the top
      // nav and the save bar stays under the form. Below lg everything stacks
      // (form, instructions, save bar) and the page scrolls normally.
      // The form track keeps a real minimum so the shared connection forms'
      // two-up fields are not crushed beside the instructions.
      columns={{ initial: "1", lg: "minmax(640px, 1fr) minmax(320px, 420px)" }}
      rows={{ initial: "auto", lg: "minmax(0, 1fr) auto" }}
      areas={{
        initial: '"form" "instructions" "footer"',
        lg: '"form instructions" "footer instructions"',
      }}
      height={{ initial: "auto", lg: "calc(100dvh - 56px)" }}
      overflow={{ initial: "visible", lg: "hidden" }}
    >
      <Box
        gridArea="form"
        py="5"
        px="6"
        minWidth="0"
        minHeight="0"
        overflowY={{ initial: "visible", lg: "auto" }}
        style={{ scrollbarGutter: "stable" }}
      >
        <Flex align="center" gap="3" wrap="wrap" mb="2">
          <Avatar size="lg" variant="soft" radius="small" color="violet">
            {DATA_SOURCE_TYPE_ABBR[type]}
          </Avatar>
          <Heading as="h1" size="xl" mb="0">
            {existing
              ? `Edit ${typeInfo.display}`
              : `Connect ${typeInfo.display}`}
          </Heading>
          {setup === "event_forwarder" ? (
            <Badge label="Event Forwarder" color="violet" variant="soft" />
          ) : null}
        </Flex>
        <Text as="p" color="text-mid" mb="4">
          {checksWrite
            ? "GrowthBook reads your data to run analysis, and writes forwarded events to the destination below."
            : "GrowthBook reads your data to run analysis. It only needs read access."}
        </Text>

        {isSampleData && (
          <Callout status="warning" mb="4">
            You cannot edit the sample Data Source connection.
          </Callout>
        )}

        <Frame mb="4">
          <Heading as="h3" size="md" mb="4">
            Connection
          </Heading>
          <TextField
            label="Data Source name"
            name="name"
            required
            markRequired
            value={datasource.name || ""}
            onChange={onChange}
            disabled={isSampleData}
            autoFocus={!existing}
            mb="3"
          />
          {showProjectPicker ? (
            <Box mb="3">
              <MultiSelectField
                label="Projects"
                placeholder="All Projects"
                value={datasource.projects || []}
                options={projectOptions}
                onChange={(projects) =>
                  updateDatasource({ ...datasource, projects })
                }
                helpText="Only Projects where you can create Data Sources are listed."
                error={projectPermissionError ?? undefined}
                errorLevel="warning"
              />
            </Box>
          ) : null}
          <ConnectionSettings
            datasource={datasource}
            existing={existing}
            hasError={hasError}
            setDatasource={updateDatasource}
            setDirty={setDirty}
            connectionOnly
            keyPairGenerator={keyPairGenerator}
          />
        </Frame>

        {checksWrite ? (
          <EventForwarderDestinationFields
            type={type}
            params={datasource.params}
            location={eventDestination.location}
            tablePrefix={eventDestination.tablePrefix}
            zerobusEndpoint={eventDestination.zerobusEndpoint}
            onLocationChange={(location) =>
              updateEventDestination({ location })
            }
            onTablePrefixChange={(tablePrefix) =>
              updateEventDestination({ tablePrefix })
            }
            onZerobusEndpointChange={(zerobusEndpoint) =>
              updateEventDestination({ zerobusEndpoint })
            }
            schemaDefaultsToConnection={type === "snowflake"}
            disabled={isSampleData}
          />
        ) : null}

        {canTest && (
          <Frame
            mb="4"
            style={{
              borderColor: testBorderColor,
              borderWidth: 1,
              borderStyle: "solid",
            }}
          >
            <Flex align="center" justify="between" gap="3" mb="2">
              <Heading as="h3" size="md" mb="0">
                Connection Test
              </Heading>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  !connectionInputsReady ||
                  testStatus === "running" ||
                  detectingRegion ||
                  isSampleData
                }
                loading={testStatus === "running" || detectingRegion}
                icon={<PiArrowClockwise />}
                onClick={runTest}
              >
                {testStatus === "idle"
                  ? "Test connection"
                  : testStatus === "running"
                    ? "Testing"
                    : "Retry test"}
              </Button>
            </Flex>
            {readStatus === "idle" || readStatus === "running" ? (
              <Text as="p" size="sm" color="text-mid" mb="0">
                {!connectionInputsReady
                  ? missingTestInputsHint
                  : checksWrite
                    ? "Checks that GrowthBook can read your data and create tables in the event destination."
                    : "Checks that GrowthBook can connect and read your data."}
              </Text>
            ) : (
              <Flex direction="column" gap="3" mt="3">
                <ConnectionTestRow
                  access="read"
                  status={readStatus}
                  name={readAccessTarget}
                  error={readStatus === "failed" ? readMessage : null}
                />
                {checksWrite &&
                writeStatus === "running" &&
                !detectingRegion ? (
                  <Text as="p" size="sm" color="text-mid" mb="0">
                    Checking write access
                  </Text>
                ) : null}
                {checksWrite &&
                (writeStatus === "passed" || writeStatus === "failed") ? (
                  <ConnectionTestRow
                    access="write"
                    status={writeStatus}
                    name={
                      eventDestination.location.trim() ||
                      (type === "bigquery" ? "your dataset" : "your schema")
                    }
                    error={writeStatus === "failed" ? writeMessage : null}
                  />
                ) : null}
                {checksWrite &&
                readStatus === "failed" &&
                writeStatus === "idle" ? (
                  <Text as="p" size="sm" color="text-mid" mb="0">
                    Write access was not checked.
                  </Text>
                ) : null}
                {checksWrite && detectingRegion ? (
                  <Text as="p" size="sm" color="text-mid" mb="0">
                    Finding the warehouse region
                  </Text>
                ) : null}
                {checksWrite &&
                writeStatus === "passed" &&
                regionChoiceRequired &&
                sinkType ? (
                  <Box>
                    <Flex align="center" gap="1" mb="1">
                      <Text as="div" weight="semibold">
                        Warehouse region
                      </Text>
                      <Tooltip
                        content={warehouseRegionHelp(sinkType)}
                        maxWidth="280px"
                      >
                        <IconButton
                          type="button"
                          variant="ghost"
                          color="gray"
                          size="1"
                          aria-label="How to find your warehouse region"
                        >
                          <PiQuestion />
                        </IconButton>
                      </Tooltip>
                    </Flex>
                    <Text as="p" size="sm" color="text-mid" mb="2">
                      {detectedWarehouseRegionId && manualWarehouseRegionId
                        ? "We detected your warehouse region. Confirm it below or choose a different region. "
                        : detectedWarehouseRegionId
                          ? `We detected ${detectedWarehouseRegionId}, but its mapped ingestor is not enabled. If this detection is incorrect, choose a different region. `
                          : "We could not detect your warehouse region. Choose it below so GrowthBook can route events to the closest ingestor. "}
                      <Text
                        as="span"
                        size="sm"
                        color="text-mid"
                        fontStyle="italic"
                      >
                        This can&apos;t be changed later.
                      </Text>
                    </Text>
                    <Box maxWidth="360px">
                      <SelectField
                        aria-label="Warehouse region"
                        value={manualWarehouseRegionId}
                        onChange={chooseManualRegion}
                        placeholder="Select a region"
                        options={regionOptions}
                        sort={false}
                        size="md"
                        legacyLabelFormatting={false}
                        noOptionsMessage={() => "No matching regions"}
                      />
                    </Box>
                  </Box>
                ) : null}
                {checksWrite &&
                writeStatus === "passed" &&
                regionBlockedMessage ? (
                  <Callout status="error">{regionBlockedMessage}</Callout>
                ) : null}
                {checksWrite && writeStatus === "passed" && resolvedRegion ? (
                  <Text as="p" size="sm" color="text-mid" mb="0">
                    Events will be routed to GrowthBook&apos;s{" "}
                    <Text as="span" size="sm" weight="medium">
                      {ingestorForRegion(resolvedRegion)}
                    </Text>
                    , then written to your warehouse.
                  </Text>
                ) : null}
              </Flex>
            )}
          </Frame>
        )}

        {saveError ? (
          <Box ref={saveErrorRef} mb="4">
            <Callout status="error">{saveError}</Callout>
          </Box>
        ) : null}
      </Box>

      <Box gridArea="instructions" minWidth="0" minHeight="0">
        <DataSourceConnectInstructions
          type={type}
          displayName={typeInfo.display}
          docs={typeInfo.docs}
          setup={setup}
          params={datasource.params}
          existing={existing}
          // Saving requires a passing connection test, so on edit the saved
          // user exists in the warehouse and the SQL can alter it.
          savedParams={existing ? initial.params : null}
          eventForwarderRegion={eventForwarderRegion}
          eventForwarderDestination={instructionsEventDestination}
          snowflakeKeyPair={snowflakeKeyPair}
        />
      </Box>

      <Flex
        gridArea="footer"
        align="center"
        justify="end"
        gap="4"
        wrap="wrap"
        px="6"
        py="4"
        style={{
          background: "var(--background-color)",
          borderTop: "1px solid var(--gray-a5)",
        }}
      >
        {saveHint ? (
          <Text size="sm" color="text-mid">
            {saveHint}
          </Text>
        ) : null}
        <Button variant="ghost" onClick={onCancel}>
          {existing ? "Cancel" : "Back"}
        </Button>
        <Button disabled={!canSave} loading={saving} onClick={handleSave}>
          {existing ? "Save changes" : "Create Data Source"}
        </Button>
      </Flex>
    </Grid>
  );
}

function ConnectionTestRow({
  access,
  status,
  name,
  error,
}: {
  access: "read" | "write";
  status: "passed" | "failed";
  name: string;
  error: string | null;
}) {
  const passed = status === "passed";
  const verb = access === "write" ? "write" : "read";

  return (
    <Box>
      <Flex align="center" gap="3">
        <Flex
          align="center"
          justify="center"
          flexShrink="0"
          aria-hidden
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: passed ? "var(--green-a3)" : "var(--red-a3)",
            color: passed ? "var(--green-11)" : "var(--red-11)",
          }}
        >
          {passed ? <PiCheckBold size={12} /> : <PiXBold size={12} />}
        </Flex>
        <Text as="span" size="sm" color="text-high">
          {passed
            ? `Confirmed ${verb} access to`
            : `Could not confirm ${verb} access to`}{" "}
          <Text as="span" size="sm" weight="medium">
            {name}
          </Text>
        </Text>
      </Flex>
      {!passed && error ? (
        <Callout status="error" size="sm" mt="3">
          <Text as="span" size="sm" mono overflowWrap="anywhere">
            {error}
          </Text>
        </Callout>
      ) : null}
    </Box>
  );
}
