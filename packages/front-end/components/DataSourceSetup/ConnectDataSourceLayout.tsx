import {
  ChangeEventHandler,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { PiArrowClockwise, PiCheckBold, PiXBold } from "react-icons/pi";
import isEqual from "lodash/isEqual";
import {
  DataSourceInterfaceWithParams,
  DataSourceType,
  SchemaFormat,
} from "shared/types/datasource";
import { isSampleDatasource } from "shared/demo-datasource";
import { isTestableDataSourceType } from "shared/validators";
import { BigQueryTestStatus } from "@/components/Settings/BigQueryForm";
import ConnectionSettings from "@/components/Settings/ConnectionSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useProjectOptions from "@/hooks/useProjectOptions";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getInitialSettings, hasEventTrackerSql } from "@/services/datasources";
import { dataSourceConnections } from "@/services/eventSchema";
import track from "@/services/track";
import { ensureAndReturn } from "@/types/utils";
import Avatar from "@/ui/Avatar";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import MultiSelectField from "@/ui/MultiSelectField";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import DataSourceConnectInstructions, {
  ConnectSetupKind,
} from "./DataSourceConnectInstructions";
import { DATA_SOURCE_TYPE_AVATAR } from "./dataSourceTypeAvatar";

type TestStatus = "idle" | "running" | "passed" | "failed";

// Fields BigQueryForm's test covers. Changing any of them invalidates a
// previously saved or tested connection.
const BIGQUERY_CREDENTIAL_KEYS = [
  "authType",
  "projectId",
  "apiEndpoint",
  "clientEmail",
  "privateKey",
] as const;

function paramValue(
  params: Partial<DataSourceInterfaceWithParams>["params"] | undefined,
  key: string,
): string {
  const value = (params as Partial<Record<string, unknown>> | undefined)?.[key];
  return typeof value === "string" ? value : "";
}

export type ConnectDataSourceLayoutProps = {
  mode: "create" | "edit";
  initial: Partial<DataSourceInterfaceWithParams>;
  setup?: ConnectSetupKind;
  schemaFormat?: SchemaFormat;
  source: string;
  onCancel: () => void;
  onSuccess: (id: string) => Promise<void>;
};

export default function ConnectDataSourceLayout({
  mode,
  initial,
  setup = "custom",
  schemaFormat = "custom",
  source,
  onCancel,
  onSuccess,
}: ConnectDataSourceLayoutProps) {
  const existing = mode === "edit";
  const { mutateDefinitions, projects: orgProjects } = useDefinitions();
  const { apiCall, orgId } = useAuth();
  const permissionsUtil = usePermissionsUtil();

  const [datasource, setDatasource] =
    useState<Partial<DataSourceInterfaceWithParams>>(initial);
  const [dirty, setDirty] = useState(false);
  const [paramsDirty, setParamsDirty] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [bigQueryTestStatus, setBigQueryTestStatus] =
    useState<BigQueryTestStatus | null>(null);
  const [saving, setSaving] = useState(false);
  // Incremented whenever the params a test would cover change, so a response
  // from an earlier test cannot approve credentials it never saw.
  const testRunRef = useRef(0);

  const resetTest = useCallback(() => {
    testRunRef.current += 1;
    setTestStatus("idle");
    setTestMessage(null);
  }, []);

  useEffect(() => {
    track("View Datasource Connect Page", {
      source,
      mode,
      type: initial.type,
      setup,
    });
  }, [source, mode, initial.type, setup]);

  useEffect(() => {
    if (!dirty) {
      setDatasource(initial);
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

  // BigQuery verifies the connection from the form above, which also loads
  // datasets so the user can choose a default dataset. The form reports its
  // result here and clears it whenever a credential field changes.
  const isBigQuery = datasource.type === "bigquery";
  const bigQueryDefaultDataset =
    isBigQuery && datasource.params && "defaultDataset" in datasource.params
      ? (datasource.params.defaultDataset || "").trim()
      : "";
  const bigQueryCredentialsDirty =
    isBigQuery &&
    BIGQUERY_CREDENTIAL_KEYS.some(
      (key) =>
        paramValue(datasource.params, key) !== paramValue(initial.params, key),
    );
  // Saved credentials that have not been touched were verified when saved.
  const needsBigQueryTest =
    isBigQuery && !isSampleData && (!existing || bigQueryCredentialsDirty);
  // "warning" means connected but no datasets were found; credentials are valid.
  const bigQueryTestPassed =
    bigQueryTestStatus === "success" || bigQueryTestStatus === "warning";

  const canTest =
    !!datasource.type &&
    isTestableDataSourceType(datasource.type) &&
    !isSampleData &&
    !isBigQuery;

  const runTest = async () => {
    if (
      !canTest ||
      !datasource.type ||
      !isTestableDataSourceType(datasource.type)
    ) {
      return;
    }
    const runId = (testRunRef.current += 1);
    setTestStatus("running");
    setTestMessage(null);
    setHasError(false);

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
      setTestStatus("passed");
      setTestMessage(null);
      track("Data Source Connection Test Passed", {
        source,
        mode,
        type: datasource.type,
      });
    } catch (e) {
      if (runId !== testRunRef.current) return;
      const message =
        e instanceof Error ? e.message : "Unable to connect to the Data Source";
      setTestStatus("failed");
      setTestMessage(message);
      setHasError(true);
      track("Data Source Connection Test Failed", {
        source,
        mode,
        type: datasource.type,
        error: message.slice(0, 32),
      });
    }
  };

  const needsSuccessfulTest = (!existing || paramsDirty) && canTest;
  const canSave =
    !isSampleData &&
    !!datasource.name?.trim() &&
    !!datasource.type &&
    projectPermissionError === null &&
    (!needsSuccessfulTest || testStatus === "passed") &&
    (!needsBigQueryTest || bigQueryTestPassed) &&
    (!isBigQuery || !!bigQueryDefaultDataset) &&
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
    // BigQuery's test lives inside the form ("Test Connection" button), not
    // in the Connection Test section, so point at that control.
    if (needsBigQueryTest && bigQueryTestStatus === null) {
      return "Use Test Connection above to continue";
    }
    if (needsBigQueryTest && bigQueryTestStatus === "danger") {
      return "Fix the connection and run Test Connection again to continue";
    }
    if (isBigQuery && !bigQueryDefaultDataset) {
      return "Choose a default dataset to continue";
    }
    if (needsSuccessfulTest && testStatus === "idle") {
      return "Test the connection to continue";
    }
    if (testStatus === "running") {
      return "Testing connection";
    }
    if (testStatus === "failed") {
      return "Fix the connection to continue";
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
        const putBody: Partial<DataSourceInterfaceWithParams> = {
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
        const initialSettings = getInitialSettings(
          schemaFormat,
          ensureAndReturn(datasource.params),
        );
        // Event trackers come with known identifiers and assignment SQL. A
        // custom warehouse starts empty so the user defines them in Finish
        // Setting Up.
        const prefill = hasEventTrackerSql(schemaFormat);
        const res = await apiCall<{ id: string }>("/datasources", {
          method: "POST",
          body: JSON.stringify({
            ...datasource,
            settings: {
              ...initialSettings,
              ...(datasource.settings || {}),
              ...(prefill
                ? {}
                : {
                    userIdTypes: [],
                    queries: {
                      ...initialSettings.queries,
                      ...(datasource.settings?.queries || {}),
                      exposure: [],
                    },
                  }),
            },
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
          <Avatar
            size="lg"
            variant="soft"
            radius="small"
            color={DATA_SOURCE_TYPE_AVATAR[type].color}
          >
            {DATA_SOURCE_TYPE_AVATAR[type].abbr}
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
          {setup === "event_forwarder"
            ? "GrowthBook reads your data to run analysis, and writes forwarded events to the destination you configure."
            : "GrowthBook reads your data to run analysis. It only needs read access."}
        </Text>

        {isSampleData && (
          <Callout status="warning" mb="4">
            You cannot edit the sample Data Source connection.
          </Callout>
        )}

        {saveError && (
          <Callout status="error" mb="4">
            {saveError}
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
            onBigQueryTestResult={setBigQueryTestStatus}
          />
        </Frame>

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
                disabled={testStatus === "running" || isSampleData}
                loading={testStatus === "running"}
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
            {testStatus === "idle" || testStatus === "running" ? (
              <Text as="p" size="sm" color="text-mid" mb="0">
                {setup === "event_forwarder"
                  ? "Checks that GrowthBook can connect and read your data. Write access for the Event Forwarder is validated when you finish setup."
                  : "Checks that GrowthBook can connect and read your data."}
              </Text>
            ) : (
              <ConnectionTestRow
                status={testStatus}
                name={readAccessTarget}
                error={testStatus === "failed" ? testMessage : null}
              />
            )}
          </Frame>
        )}
      </Box>

      <Box gridArea="instructions" minWidth="0" minHeight="0">
        <DataSourceConnectInstructions
          type={type}
          displayName={typeInfo.display}
          docs={typeInfo.docs}
          setup={setup}
          params={datasource.params}
          existing={existing}
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
          Cancel
        </Button>
        <Button disabled={!canSave} loading={saving} onClick={handleSave}>
          {existing ? "Save changes" : "Create Data Source"}
        </Button>
      </Flex>
    </Grid>
  );
}

function ConnectionTestRow({
  status,
  name,
  error,
}: {
  status: "passed" | "failed";
  name: string;
  error: string | null;
}) {
  const passed = status === "passed";

  return (
    <Box mt="4">
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
            ? "Confirmed read access to"
            : "Could not confirm read access to"}{" "}
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
