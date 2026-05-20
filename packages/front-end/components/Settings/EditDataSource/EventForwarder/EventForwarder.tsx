import { useState } from "react";
import {
  DEFAULT_EVENT_FORWARDER_BIGQUERY_TABLE_NAME,
  DEFAULT_EVENT_FORWARDER_SNOWFLAKE_TABLE_NAME,
  formatBigQueryEventForwarderDestination,
  formatSnowflakeEventForwarderDestination,
  parseBigQueryEventForwarderDestination,
  parseSnowflakeEventForwarderDestination,
  stripLeadingUtf8ByteOrderMark,
  tryDeriveSnowflakeAccessUrlFromAccount,
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
import BigQueryEventForwarderForm from "@/components/Settings/BigQueryEventForwarderForm";
import SnowflakeEventForwarderForm from "@/components/Settings/SnowflakeEventForwarderForm";
import { useEventForwarderAccessTest } from "@/components/Settings/useEventForwarderAccessTest";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import Modal from "@/ui/Modal";
import ModalForm, { useModalForm } from "@/ui/Modal/ModalForm";

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

const EVENT_FORWARDER_MODAL_FAILURE_MESSAGE =
  "Something went wrong. Update your settings and try again.";

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
        role: existing.config.role,
        warehouse: existing.config.warehouse,
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
        tableName: formatBigQueryEventForwarderDestination({
          dataset: params.defaultDataset || "",
          table: DEFAULT_EVENT_FORWARDER_BIGQUERY_TABLE_NAME,
        }),
        ...(serviceAccountKey ? { serviceAccountKey } : {}),
      },
    };
  }
  if (dataSource.type === "snowflake") {
    const params = dataSource.params as SnowflakeConnectionParams;
    return {
      sinkType: "snowflake",
      config: {
        tableName: formatSnowflakeEventForwarderDestination({
          database: params.database || "",
          schema: params.schema || "",
          table: DEFAULT_EVENT_FORWARDER_SNOWFLAKE_TABLE_NAME,
        }),
        accessUrl:
          params.accessUrl?.trim() ||
          tryDeriveSnowflakeAccessUrlFromAccount(params.account || "") ||
          "",
        role: params.role || "",
        warehouse: params.warehouse || "",
      },
    };
  }

  return null;
}

function getEventForwarderParamsForSubmit(
  dataSource: DataSourceInterfaceWithParams,
  draft: EventForwarderDatasourceDraft,
): Partial<DataSourceParams> | undefined {
  if (draft.type !== "bigquery") return undefined;
  const cfg = draft.eventForwarderConfig;
  if (!cfg || cfg.sinkType !== "bigquery") return undefined;

  try {
    const parsed = parseBigQueryEventForwarderDestination(cfg.config.tableName);
    const originalParams =
      dataSource.params as Partial<BigQueryConnectionParams>;
    if (parsed.dataset === (originalParams.defaultDataset || "")) {
      return undefined;
    }
    return {
      defaultDataset: parsed.dataset,
    } as Partial<DataSourceParams>;
  } catch {
    return undefined;
  }
}

function getCanConfirmEventForwarder(
  draft: EventForwarderDatasourceDraft,
): boolean {
  const cfg = draft.eventForwarderConfig;
  if (!cfg) return false;
  const rawParams = draft.params || {};
  if (cfg.sinkType === "bigquery") {
    try {
      parseBigQueryEventForwarderDestination(cfg.config.tableName);
      return true;
    } catch {
      return false;
    }
  }
  if (cfg.sinkType === "snowflake") {
    const p = rawParams as Partial<SnowflakeConnectionParams>;
    const authMethod = p.authMethod ?? "password";
    const hasSnowflakePrivateKey =
      authMethod === "key-pair" || !!p.privateKey?.trim();
    try {
      parseSnowflakeEventForwarderDestination(cfg.config.tableName);
    } catch {
      return false;
    }
    return (
      !!cfg.config.accessUrl?.trim() &&
      !!p.account?.trim() &&
      !!p.username?.trim() &&
      authMethod === "key-pair" &&
      hasSnowflakePrivateKey
    );
  }
  return false;
}

function EventForwarderConfirmButton({
  canConfirmEventForwarder,
  usEventForwarderFlowConsent,
  datasourceDraft,
}: {
  canConfirmEventForwarder: boolean;
  usEventForwarderFlowConsent: boolean;
  datasourceDraft: EventForwarderDatasourceDraft;
}) {
  const { loading } = useModalForm();
  const ctaEnabled = canConfirmEventForwarder && usEventForwarderFlowConsent;
  const disabledMessage = !canConfirmEventForwarder
    ? datasourceDraft.type === "bigquery"
      ? "Enter a destination table (dataset.table) before confirming."
      : "Enter destination table, Snowflake URL, and required connection fields before confirming."
    : !usEventForwarderFlowConsent
      ? "Acknowledge US data flow and authorization to use Confirm."
      : undefined;

  return (
    <Tooltip
      body={disabledMessage || ""}
      shouldDisplay={!ctaEnabled && !!disabledMessage}
      tipPosition="top"
    >
      <Button type="submit" disabled={!ctaEnabled} loading={loading}>
        Confirm
      </Button>
    </Tooltip>
  );
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
  const isEditingEventForwarder = !!dataSource.eventForwarderConfig;
  const [usEventForwarderFlowConsent, setUsEventForwarderFlowConsent] =
    useState(isEditingEventForwarder);

  const setEventForwarderConfig = (
    eventForwarderConfig: EventForwarderConfigDraft | null,
  ) => {
    setDatasourceDraft((current) => ({
      ...current,
      eventForwarderConfig,
    }));
  };

  const eventForwarderConfig = datasourceDraft.eventForwarderConfig;
  const modalTitle = isEditingEventForwarder
    ? "Edit Event Forwarder"
    : "Set Up Event Forwarder";
  const params = datasourceDraft.params || {};
  const eventForwarderParamsForSubmit = getEventForwarderParamsForSubmit(
    dataSource,
    datasourceDraft,
  );

  const accessTestParams =
    eventForwarderParamsForSubmit ?? (params as Partial<DataSourceParams>);

  const { testEventForwarderAccess } = useEventForwarderAccessTest({
    existing: true,
    datasourceId: dataSource.id,
    type: datasourceDraft.type,
    params: accessTestParams,
    projects: dataSource.projects,
    eventForwarderConfig,
  });

  const canConfirmEventForwarder = getCanConfirmEventForwarder(datasourceDraft);

  return (
    <Modal.Root
      open={true}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
      size="md"
      trackingEventModalType=""
    >
      <ModalForm
        onSubmit={async () => {
          if (!eventForwarderConfig) return;
          try {
            await testEventForwarderAccess();
            await apiCall(`/datasource/${dataSource.id}/event-forwarder`, {
              method: "PUT",
              body: JSON.stringify({
                eventForwarderConfig,
                ...(eventForwarderParamsForSubmit
                  ? { params: eventForwarderParamsForSubmit }
                  : {}),
              }),
            });
            await onRefresh();
            onCancel();
          } catch {
            throw new Error(EVENT_FORWARDER_MODAL_FAILURE_MESSAGE);
          }
        }}
      >
        <Modal.Header>
          <Modal.Title>{modalTitle}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {eventForwarderConfig?.sinkType === "bigquery" ? (
            <BigQueryEventForwarderForm
              eventForwarderConfig={eventForwarderConfig}
              setEventForwarderConfig={setEventForwarderConfig}
              className="form-group col-md-12 px-0"
            />
          ) : null}
          {eventForwarderConfig?.sinkType === "snowflake" ? (
            <SnowflakeEventForwarderForm
              eventForwarderConfig={eventForwarderConfig}
              setEventForwarderConfig={setEventForwarderConfig}
            />
          ) : null}
          <Callout status="info" mb="0" mt="3" icon={null}>
            <Checkbox
              value={usEventForwarderFlowConsent}
              setValue={setUsEventForwarderFlowConsent}
              disabled={isEditingEventForwarder}
              label="I understand that event data will flow through GrowthBook's US servers and confirm I'm authorized to enable this for my organization."
              weight="regular"
            />
          </Callout>
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </Modal.Close>
          <EventForwarderConfirmButton
            canConfirmEventForwarder={canConfirmEventForwarder}
            usEventForwarderFlowConsent={usEventForwarderFlowConsent}
            datasourceDraft={datasourceDraft}
          />
        </Modal.Footer>
      </ModalForm>
    </Modal.Root>
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
          {canEdit && eventForwarderConfig ? (
            <>
              <Button variant="outline" onClick={() => setShowEditModal(true)}>
                Edit Event Forwarder
              </Button>
              {/* TEMP: remove once self-serve delete ships */}
              <Button
                variant="outline"
                color="red"
                setError={setError}
                onClick={async () => {
                  if (
                    !window.confirm(
                      "Delete this Event Forwarder configuration? This cannot be undone from the UI.",
                    )
                  ) {
                    return;
                  }
                  await apiCall(
                    `/datasource/${dataSource.id}/event-forwarder`,
                    { method: "DELETE" },
                  );
                  await onRefresh();
                }}
              >
                Delete Event Forwarder (temp)
              </Button>
            </>
          ) : null}
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
      ) : isPaused ? (
        <Callout status="info" mb="3">
          To remove the Event Forwarder, contact your account manager.
        </Callout>
      ) : null}

      {eventForwarderConfig ? (
        <Card>
          <Flex direction="column" gap="3" p="2">
            <Flex direction="column" gap="4">
              <Box>
                <Text weight="medium">Destination table: </Text>
                {tableName ? (
                  <code>{tableName}</code>
                ) : (
                  <Text color="text-low">None</Text>
                )}
              </Box>
            </Flex>

            {eventForwarderConfig.lastProvisioningError ? (
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
      ) : null}
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
