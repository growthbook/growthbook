import {
  ChangeEventHandler,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowClockwise, PiArrowLeft } from "react-icons/pi";
import {
  DataSourceInterfaceWithParams,
  DataSourceType,
  SchemaFormat,
} from "shared/types/datasource";
import { isSampleDatasource } from "shared/demo-datasource";
import {
  isTestableDataSourceType,
  TestableDataSourceType,
} from "shared/validators";
import ConnectionSettings from "@/components/Settings/ConnectionSettings";
import Field from "@/components/Forms/Field";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getInitialSettings } from "@/services/datasources";
import { dataSourceConnections } from "@/services/eventSchema";
import track from "@/services/track";
import { ensureAndReturn } from "@/types/utils";
import Avatar from "@/ui/Avatar";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import DataSourceConnectInstructions, {
  ConnectSetupKind,
} from "./DataSourceConnectInstructions";
import { DATA_SOURCE_TYPE_AVATAR } from "./dataSourceTypeAvatar";

type TestStatus = "idle" | "running" | "passed" | "failed";

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
  const { mutateDefinitions } = useDefinitions();
  const { apiCall, orgId } = useAuth();

  const [datasource, setDatasource] =
    useState<Partial<DataSourceInterfaceWithParams>>(initial);
  const [dirty, setDirty] = useState(false);
  const [paramsDirty, setParamsDirty] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
      setTestStatus("idle");
      setTestMessage(null);
    }
  }, [initial, dirty]);

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
      if (next.params !== datasource.params) {
        setParamsDirty(true);
        setTestStatus("idle");
        setTestMessage(null);
      }
    },
    [datasource.params],
  );

  const onChange: ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement> = (
    e,
  ) => {
    updateDatasource({
      ...datasource,
      [e.target.name]: e.target.value,
    });
  };

  // BigQuery verifies the connection from the form above, which also loads
  // datasets so the user can choose a default dataset.
  const isBigQuery = datasource.type === "bigquery";
  const bigQueryDefaultDataset =
    isBigQuery && datasource.params && "defaultDataset" in datasource.params
      ? (datasource.params.defaultDataset || "").trim()
      : "";

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
    setTestStatus("running");
    setTestMessage(null);
    setHasError(false);

    try {
      const body: {
        type: TestableDataSourceType;
        params: Record<string, unknown>;
        projects?: string[];
        datasourceId?: string;
      } = {
        type: datasource.type,
        params: (datasource.params || {}) as Record<string, unknown>,
        projects: datasource.projects,
      };
      if (existing && datasource.id) {
        body.datasourceId = datasource.id;
      }

      const res = await apiCall<{ status: number; message?: string }>(
        "/datasources/test-connection",
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      );
      if (res.status > 200) {
        throw new Error(res.message || "Unable to connect to the Data Source");
      }
      setTestStatus("passed");
      setTestMessage("Connection successful.");
      track("Data Source Connection Test Passed", {
        source,
        mode,
        type: datasource.type,
      });
    } catch (e) {
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
    (!needsSuccessfulTest || testStatus === "passed") &&
    (!isBigQuery || !!bigQueryDefaultDataset) &&
    (existing ? dirty : true);

  const saveHint = (() => {
    if (isSampleData) {
      return "You cannot edit the sample Data Source connection.";
    }
    if (!datasource.name?.trim()) {
      return "Enter a Data Source name to continue";
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
        const putBody = { ...datasource };
        delete putBody.eventForwarderConfig;
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
        const res = await apiCall<{ id: string }>("/datasources", {
          method: "POST",
          body: JSON.stringify({
            ...datasource,
            settings: {
              ...getInitialSettings(
                schemaFormat,
                ensureAndReturn(datasource.params),
              ),
              ...(datasource.settings || {}),
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
  const testBorderColor =
    testStatus === "failed"
      ? "var(--red-7)"
      : testStatus === "passed"
        ? "var(--green-7)"
        : "var(--gray-a5)";

  return (
    <Box
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(420px, 560px)",
        // Independent column scroll: lock to the viewport below the top nav
        // and let each column scroll its own content.
        height: "calc(100dvh - 56px)",
        maxHeight: "calc(100dvh - 56px)",
        overflow: "hidden",
        alignItems: "stretch",
      }}
    >
      <Flex
        direction="column"
        style={{
          width: "100%",
          minWidth: 0,
          minHeight: 0,
          height: "100%",
        }}
      >
        <Box
          py="5"
          px="6"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            scrollbarGutter: "stable",
          }}
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
            <Badge
              label={setup === "event_forwarder" ? "Event Forwarder" : "Custom"}
              color="violet"
              variant="soft"
            />
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
            <Field
              label="Data Source name"
              name="name"
              required
              value={datasource.name || ""}
              onChange={onChange}
              disabled={isSampleData}
              containerClassName="mb-3"
              autoFocus={!existing}
            />
            <ConnectionSettings
              datasource={datasource}
              existing={existing}
              hasError={hasError}
              setDatasource={updateDatasource}
              setDirty={(next) => {
                setDirty(next);
                if (next) {
                  setParamsDirty(true);
                  setTestStatus("idle");
                  setTestMessage(null);
                }
              }}
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
                  onClick={async () => {
                    await runTest();
                  }}
                >
                  {testStatus === "idle"
                    ? "Test connection"
                    : testStatus === "running"
                      ? "Testing"
                      : "Retry test"}
                </Button>
              </Flex>
              {testStatus === "idle" && (
                <Text as="p" size="sm" color="text-mid" mb="0">
                  {setup === "event_forwarder"
                    ? "Checks that GrowthBook can connect and read your data. Write access for the Event Forwarder is validated when you finish setup."
                    : "Checks that GrowthBook can connect and read your data."}
                </Text>
              )}
              {testMessage && (
                <Callout
                  status={testStatus === "passed" ? "success" : "error"}
                  mt="3"
                >
                  {testMessage}
                </Callout>
              )}
            </Frame>
          )}
        </Box>

        <Flex
          align="center"
          justify="between"
          gap="3"
          wrap="wrap"
          px="6"
          py="4"
          flexShrink="0"
          style={{
            background: "var(--background-color)",
            borderTop: "1px solid var(--gray-a5)",
          }}
        >
          <Button
            variant="ghost"
            color="gray"
            icon={<PiArrowLeft />}
            onClick={onCancel}
          >
            Back
          </Button>
          <Flex align="center" gap="3">
            {saveHint ? (
              <Text size="sm" color="text-mid">
                {saveHint}
              </Text>
            ) : null}
            <Button
              disabled={!canSave}
              loading={saving}
              onClick={async () => {
                await handleSave();
              }}
            >
              {existing ? "Save changes" : "Create Data Source"}
            </Button>
          </Flex>
        </Flex>
      </Flex>

      <DataSourceConnectInstructions
        type={type}
        displayName={typeInfo.display}
        docs={typeInfo.docs}
        setup={setup}
        params={datasource.params}
      />
    </Box>
  );
}
