import { useEffect, useState } from "react";
import {
  DEFAULT_EVENT_FORWARDER_BIGQUERY_TABLE_NAME,
  DEFAULT_EVENT_FORWARDER_SNOWFLAKE_TABLE_NAME,
  computeEventForwarderAccessSignature,
  stripLeadingUtf8ByteOrderMark,
} from "shared/util";
import {
  EventForwarderConfigDraft,
  EventForwarderStatus,
} from "shared/types/event-forwarder";
import {
  DataSourceInterfaceWithParams,
  DataSourceParams,
} from "shared/types/datasource";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import { Box, Card, Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Modal from "@/components/Modal";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import BigQueryEventForwarderForm from "@/components/Settings/BigQueryEventForwarderForm";
import SnowflakeEventForwarderForm from "@/components/Settings/SnowflakeEventForwarderForm";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";

type Props = {
  dataSource: DataSourceInterfaceWithParams;
  canEdit?: boolean;
  onRefresh: () => Promise<void>;
};

type EventForwarderDatasourceDraft = {
  type: "bigquery" | "snowflake";
  params:
    | Partial<BigQueryConnectionParams>
    | Partial<SnowflakeConnectionParams>;
  projects?: string[];
  eventForwarderConfig: EventForwarderConfigDraft | null;
};

const statusLabels: Record<EventForwarderStatus, string> = {
  pending: "Pending",
  ready: "Ready",
  paused: "Paused",
  error: "Error",
  schema_update_error: "Schema Update Error",
};

const statusColors: Record<
  EventForwarderStatus,
  "gray" | "green" | "amber" | "red"
> = {
  pending: "gray",
  ready: "green",
  paused: "amber",
  error: "red",
  schema_update_error: "red",
};

function getEventForwarderDraft(
  dataSource: DataSourceInterfaceWithParams,
): EventForwarderConfigDraft | null {
  const existing = dataSource.eventForwarderConfig;
  if (existing?.sinkType === "bigquery") {
    return {
      sinkType: "bigquery",
      config: {
        tableName: existing.config.tableName,
        serviceAccountKey: existing.config.serviceAccountKey,
      },
    };
  }
  if (existing?.sinkType === "snowflake") {
    return {
      sinkType: "snowflake",
      config: {
        tableName: existing.config.tableName,
        accessUrl: existing.config.accessUrl,
      },
    };
  }

  if (dataSource.type === "bigquery") {
    const params = dataSource.params as BigQueryConnectionParams;
    const serviceAccountKey =
      stripLeadingUtf8ByteOrderMark(params.serviceAccountJson ?? "").trim() ||
      "";

    return {
      sinkType: "bigquery",
      config: {
        tableName: DEFAULT_EVENT_FORWARDER_BIGQUERY_TABLE_NAME,
        ...(serviceAccountKey ? { serviceAccountKey } : {}),
      },
    };
  }
  if (dataSource.type === "snowflake") {
    return {
      sinkType: "snowflake",
      config: {
        tableName: DEFAULT_EVENT_FORWARDER_SNOWFLAKE_TABLE_NAME,
        accessUrl: "",
      },
    };
  }

  return null;
}

function getEventForwarderParamsForSubmit(
  dataSource: EventForwarderDatasourceDraft,
): Partial<DataSourceParams> | undefined {
  if (dataSource.type !== "bigquery") return undefined;
  const params = dataSource.params as Partial<BigQueryConnectionParams>;
  return {
    defaultDataset: params.defaultDataset || "",
  } as Partial<DataSourceParams>;
}

function EventForwarderModal({
  dataSource,
  onCancel,
  onRefresh,
}: {
  dataSource: DataSourceInterfaceWithParams;
  onCancel: () => void;
  onRefresh: () => Promise<void>;
}) {
  const { apiCall } = useAuth();
  const [datasourceDraft, setDatasourceDraft] =
    useState<EventForwarderDatasourceDraft>(() => ({
      type: dataSource.type as "bigquery" | "snowflake",
      params: { ...dataSource.params } as
        | Partial<BigQueryConnectionParams>
        | Partial<SnowflakeConnectionParams>,
      projects: dataSource.projects,
      eventForwarderConfig: getEventForwarderDraft(dataSource),
    }));
  const [
    validatedEventForwarderSignature,
    setValidatedEventForwarderSignature,
  ] = useState<string | null>(null);

  const eventForwarderAccessSignature = computeEventForwarderAccessSignature(
    datasourceDraft as Partial<DataSourceInterfaceWithParams>,
  );
  const eventForwarderSaveBlocked =
    !!datasourceDraft.eventForwarderConfig &&
    validatedEventForwarderSignature !== eventForwarderAccessSignature;

  useEffect(() => {
    if (
      validatedEventForwarderSignature &&
      validatedEventForwarderSignature !== eventForwarderAccessSignature
    ) {
      setValidatedEventForwarderSignature(null);
    }
  }, [eventForwarderAccessSignature, validatedEventForwarderSignature]);

  const setParams = (params: { [key: string]: string | boolean }) => {
    setDatasourceDraft((current) => ({
      ...current,
      params: {
        ...current.params,
        ...params,
      },
    }));
  };
  const setEventForwarderConfig = (
    eventForwarderConfig: EventForwarderConfigDraft | null,
  ) => {
    setDatasourceDraft((current) => ({
      ...current,
      eventForwarderConfig,
    }));
  };

  const eventForwarderConfig = datasourceDraft.eventForwarderConfig;
  const modalTitle = dataSource.eventForwarderConfig
    ? "Edit Event Forwarder"
    : "Set Up Event Forwarder";
  const params = datasourceDraft.params || {};

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      submit={async () => {
        if (!eventForwarderConfig) return;
        await apiCall(`/datasource/${dataSource.id}/event-forwarder`, {
          method: "PUT",
          body: JSON.stringify({
            eventForwarderConfig,
            ...(getEventForwarderParamsForSubmit(datasourceDraft)
              ? { params: getEventForwarderParamsForSubmit(datasourceDraft) }
              : {}),
          }),
        });
        await onRefresh();
      }}
      close={onCancel}
      header={modalTitle}
      cta="Confirm"
      size="lg"
      ctaEnabled={!eventForwarderSaveBlocked}
      disabledMessage={
        eventForwarderSaveBlocked
          ? "Test Event Forwarder access before confirming."
          : undefined
      }
    >
      <p>
        Confirming will create or update the Kafka topic and connector for this
        datasource.
      </p>
      {eventForwarderConfig?.sinkType === "bigquery" ? (
        <BigQueryEventForwarderForm
          params={params as Partial<BigQueryConnectionParams>}
          accessTestParams={getEventForwarderParamsForSubmit(datasourceDraft)}
          eventForwarderConfig={eventForwarderConfig}
          existing={true}
          setParams={setParams}
          setEventForwarderConfig={setEventForwarderConfig}
          datasourceId={dataSource.id}
          projects={dataSource.projects}
          eventForwarderAccessSignature={eventForwarderAccessSignature}
          setValidatedEventForwarderSignature={
            setValidatedEventForwarderSignature
          }
          showDefaultDatasetField
          className="form-group col-md-12 px-0"
        />
      ) : null}
      {eventForwarderConfig?.sinkType === "snowflake" ? (
        <SnowflakeEventForwarderForm
          params={params as Partial<SnowflakeConnectionParams>}
          eventForwarderConfig={eventForwarderConfig}
          existing={true}
          setEventForwarderConfig={setEventForwarderConfig}
          datasourceId={dataSource.id}
          projects={dataSource.projects}
          eventForwarderAccessSignature={eventForwarderAccessSignature}
          setValidatedEventForwarderSignature={
            setValidatedEventForwarderSignature
          }
          accessTestParams={undefined}
          hasSnowflakePrivateKey={
            (params as Partial<SnowflakeConnectionParams>).authMethod ===
              "key-pair" ||
            !!(params as Partial<SnowflakeConnectionParams>).privateKey?.trim()
          }
        />
      ) : null}
    </Modal>
  );
}

export default function EventForwarder({
  dataSource,
  canEdit = true,
  onRefresh,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const { apiCall } = useAuth();
  const eventForwarderConfig = dataSource.eventForwarderConfig;

  if (dataSource.type !== "bigquery" && dataSource.type !== "snowflake") {
    return null;
  }

  const tableName =
    eventForwarderConfig && "tableName" in eventForwarderConfig.config
      ? eventForwarderConfig.config.tableName
      : "";
  const isReady = eventForwarderConfig?.status === "ready";
  const isPaused = eventForwarderConfig?.status === "paused";
  const canToggle = canEdit && (isReady || isPaused);
  const action = isReady ? "pause" : "resume";

  return (
    <Box>
      <Flex align="center" justify="between" gap="3" mb="2">
        <Flex align="center" gap="2">
          <Heading as="h3" size="medium" mb="0">
            Event Forwarder
          </Heading>
          {eventForwarderConfig ? (
            <Badge
              label={statusLabels[eventForwarderConfig.status]}
              color={statusColors[eventForwarderConfig.status]}
              variant="soft"
            />
          ) : null}
        </Flex>

        <Flex align="center" gap="4">
          {canEdit && eventForwarderConfig && (
            <MoreMenu useRadix size={16}>
              <button
                className="dropdown-item py-2"
                onClick={() => setShowEditModal(true)}
              >
                Edit Event Forwarder
              </button>

              <hr className="dropdown-divider" />
              <DeleteButton
                onClick={async () => {
                  await apiCall(
                    `/datasource/${dataSource.id}/event-forwarder`,
                    {
                      method: "DELETE",
                    },
                  );
                  await onRefresh();
                }}
                className="dropdown-item text-danger py-2"
                iconClassName="mr-2"
                style={{ borderRadius: 0 }}
                useIcon={false}
                displayName="Event Forwarder"
                deleteMessage="Are you sure you want to delete this event forwarder? This removes the GrowthBook Kafka topic and connector for this datasource."
                title="Delete"
                text="Delete Event Forwarder"
                outline={false}
              />
            </MoreMenu>
          )}
          {eventForwarderConfig && canToggle && (
            <Button
              variant="outline"
              color={isReady ? "red" : "gray"}
              setError={setError}
              style={{
                alignItems: "center",
              }}
              onClick={async () => {
                await apiCall(
                  `/datasource/${dataSource.id}/event-forwarder/${action}`,
                  {
                    method: "POST",
                  },
                );
                await onRefresh();
              }}
            >
              {isReady ? "Pause" : "Resume"}
            </Button>
          )}
        </Flex>
      </Flex>

      <p>
        Forward SDK event data from GrowthBook to this datasource for downstream
        analysis and diagnostics.
      </p>

      {!eventForwarderConfig ? (
        <Callout status="info">
          Event Forwarder is not configured for this datasource.
          {canEdit ? (
            <Box mt="3">
              <Button onClick={() => setShowEditModal(true)}>
                Set Up Event Forwarder
              </Button>
            </Box>
          ) : null}
        </Callout>
      ) : null}

      <Card>
        <Flex direction="column" gap="3" p="2">
          <Flex direction="column" gap="4">
            <Box>
              <Text weight="medium">Table Name: </Text>
              {tableName ? (
                <code>{tableName}</code>
              ) : (
                <Text color="text-low">None</Text>
              )}
            </Box>
          </Flex>

          {eventForwarderConfig?.lastProvisioningError ? (
            <Callout status="error" mb="0">
              {eventForwarderConfig.lastProvisioningError}
            </Callout>
          ) : null}
          {error ? (
            <Callout status="error" mb="0">
              {error}
            </Callout>
          ) : null}
        </Flex>
      </Card>
      {showEditModal ? (
        <EventForwarderModal
          dataSource={dataSource}
          onCancel={() => setShowEditModal(false)}
          onRefresh={async () => {
            setShowEditModal(false);
            await onRefresh();
          }}
        />
      ) : null}
    </Box>
  );
}
