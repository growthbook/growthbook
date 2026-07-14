import { useCallback, useRef, useState } from "react";
import {
  DEFAULT_EVENT_FORWARDER_TABLE_PREFIX,
  normalizeBigQueryTablePrefixForEventForwarder,
  normalizeSnowflakeEventForwarderAccessUrl,
  normalizeSnowflakeTablePrefixForEventForwarder,
  stripLeadingUtf8ByteOrderMark,
  supportsEventForwarder,
  tryDeriveSnowflakeAccessUrlFromAccount,
} from "shared/util";
import {
  EventForwarderConfigDraft,
  EventForwarderStatus,
} from "shared/types/event-forwarder";
import { EventForwarderStatusResponse } from "shared/validators";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import { Box, Card, Flex } from "@radix-ui/themes";
import { useFeatureValue } from "@growthbook/growthbook-react";
import { PiCaretRight, PiPause, PiPencilSimple, PiPlay } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import PremiumCallout from "@/ui/PremiumCallout";
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
import ConfirmDialog from "@/ui/ConfirmDialog";
import Modal from "@/ui/Modal";
import ModalForm, { useModalForm } from "@/ui/Modal/ModalForm";
import LoadingSpinner from "@/components/LoadingSpinner";
import { DocLink } from "@/components/DocLink";
import {
  PROVISIONING_TIMEOUT_MESSAGE,
  useEventForwarderProvisioningPoll,
} from "@/components/Settings/EditDataSource/EventForwarder/useEventForwarderProvisioningPoll";

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

function getTaskErrorMessage(
  taskErrors: EventForwarderStatusResponse["taskErrors"],
): string | undefined {
  if (!taskErrors?.length) return undefined;

  const traces = [
    ...new Set(
      taskErrors
        .map((task) => task.trace?.trim())
        .filter((trace): trace is string => Boolean(trace)),
    ),
  ];
  return traces.length > 0 ? traces.join("\n") : undefined;
}

function getPrimaryConnectorErrorMessage({
  actionError,
  lastProvisioningError,
  pollTimedOut,
  taskErrors,
}: {
  actionError?: string | null;
  lastProvisioningError: string | undefined;
  pollTimedOut: boolean;
  taskErrors: EventForwarderStatusResponse["taskErrors"];
}): string | undefined {
  if (actionError?.trim()) return actionError.trim();
  const taskErrorMessage = getTaskErrorMessage(taskErrors);
  if (taskErrorMessage) return taskErrorMessage;
  if (lastProvisioningError?.trim()) return lastProvisioningError.trim();
  if (pollTimedOut) return PROVISIONING_TIMEOUT_MESSAGE;
  return undefined;
}

function getEventForwarderDraft(
  dataSource: DataSourceInterfaceWithParams,
): EventForwarderConfigDraft | null {
  const existing = dataSource.eventForwarderConfig;
  if (existing?.sinkType === "bigquery") {
    return {
      sinkType: "bigquery",
      config: {
        projectId: existing.config.projectId,
        dataset: existing.config.dataset,
        tablePrefix: existing.config.tablePrefix,
        serviceAccountKey: existing.config.serviceAccountKey,
      },
    };
  }
  if (existing?.sinkType === "snowflake") {
    return {
      sinkType: "snowflake",
      config: {
        database: existing.config.database,
        schema: existing.config.schema,
        tablePrefix: existing.config.tablePrefix,
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
        projectId: params.defaultProject || params.projectId || "",
        dataset: params.defaultDataset || "",
        tablePrefix: DEFAULT_EVENT_FORWARDER_TABLE_PREFIX,
        ...(serviceAccountKey ? { serviceAccountKey } : {}),
      },
    };
  }
  if (dataSource.type === "snowflake") {
    const params = dataSource.params as SnowflakeConnectionParams;
    return {
      sinkType: "snowflake",
      config: {
        database: params.database || "",
        schema: params.schema || "",
        tablePrefix: DEFAULT_EVENT_FORWARDER_TABLE_PREFIX.toUpperCase(),
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

// Validates what the browser's native `required` validation can't cover:
// datasource connection params that aren't inputs in this modal
// (account/username/auth method), and *format* of free-form fields (table
// prefix, access URL). Empty visible required fields (BigQuery project/dataset,
// Snowflake database/schema) are handled by native `required` on the inputs, so
// don't re-check emptiness here — that duplicates the per-field tooltip. The
// access URL is the exception: it's only conditionally editable/required in the
// UI, so this validator owns its emptiness too as a backstop (native gates
// submit first, so it never double-messages).
function getEventForwarderValidationErrors(
  draft: EventForwarderDatasourceDraft,
): string[] {
  const cfg = draft.eventForwarderConfig;
  if (!cfg) return ["Event forwarder configuration is missing."];
  const rawParams = draft.params || {};
  const errors: string[] = [];

  if (cfg.sinkType === "bigquery") {
    try {
      normalizeBigQueryTablePrefixForEventForwarder(cfg.config.tablePrefix);
    } catch (e) {
      errors.push(
        e instanceof Error ? e.message : "Enter a valid table prefix.",
      );
    }
    return errors;
  }

  if (cfg.sinkType === "snowflake") {
    const p = rawParams as Partial<SnowflakeConnectionParams>;
    const authMethod = p.authMethod ?? "password";
    if (!p.account?.trim()) errors.push("Enter a Snowflake account.");
    if (!p.username?.trim()) errors.push("Enter a Snowflake username.");
    if (authMethod !== "key-pair") {
      errors.push("Use key-pair authentication for the Snowflake connection.");
    }
    const accessUrl = cfg.config.accessUrl?.trim();
    if (!accessUrl) {
      errors.push("Enter a Snowflake access URL.");
    } else {
      try {
        normalizeSnowflakeEventForwarderAccessUrl(accessUrl);
      } catch (e) {
        errors.push(
          e instanceof Error
            ? e.message
            : "Enter a valid Snowflake access URL.",
        );
      }
    }
    try {
      normalizeSnowflakeTablePrefixForEventForwarder(cfg.config.tablePrefix);
    } catch (e) {
      errors.push(
        e instanceof Error ? e.message : "Enter a valid table prefix.",
      );
    }
    return errors;
  }

  return ["Unsupported event forwarder type."];
}

function EventForwarderConfigField({
  label,
  value,
  optional = false,
}: {
  label: string;
  value: string | undefined;
  optional?: boolean;
}) {
  const trimmed = value?.trim();

  return (
    <Box>
      <Text size="small" weight="medium" color="text-mid" mb="1">
        {optional ? `${label} (optional)` : label}
      </Text>
      {trimmed ? (
        <Text as="div" size="small" weight="regular" color="text-high">
          {trimmed}
        </Text>
      ) : (
        <Text color="text-low" size="small">
          {optional ? "Not set" : "None"}
        </Text>
      )}
    </Box>
  );
}

function SyncSubmittingRef({
  submittingRef,
}: {
  submittingRef: React.MutableRefObject<boolean>;
}) {
  const { loading } = useModalForm();
  submittingRef.current = loading;
  return null;
}

function EventForwarderConfirmButton({
  usEventForwarderFlowConsent,
}: {
  usEventForwarderFlowConsent: boolean;
}) {
  const { loading } = useModalForm();

  return (
    <Tooltip
      body="Acknowledge US data flow and authorization to use Confirm."
      shouldDisplay={!usEventForwarderFlowConsent}
      tipPosition="top"
    >
      <Button
        type="submit"
        disabled={!usEventForwarderFlowConsent}
        loading={loading}
        icon={<PiCaretRight size={12} />}
        iconPosition="right"
      >
        Confirm
      </Button>
    </Tooltip>
  );
}

function EventForwarderModal({
  dataSource,
  onCancel,
  onRefresh,
  onClearError,
  onRefreshError,
}: {
  dataSource: DataSourceInterfaceWithParams;
  onCancel: () => void;
  onRefresh: () => Promise<void>;
  onClearError: () => void;
  onRefreshError: (message: string) => void;
}) {
  const { apiCall } = useAuth();
  const isSubmittingRef = useRef(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
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

  const { testEventForwarderAccess } = useEventForwarderAccessTest({
    existing: true,
    datasourceId: dataSource.id,
    type: datasourceDraft.type,
    params,
    projects: dataSource.projects,
    eventForwarderConfig,
  });

  const attemptClose = useCallback(() => {
    if (isSubmittingRef.current) {
      setShowCloseConfirm(true);
      return;
    }
    onCancel();
  }, [onCancel]);

  return (
    <>
      <Modal.Root
        open={true}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) attemptClose();
        }}
        size="md"
        trackingEventModalType=""
      >
        <ModalForm
          onSubmit={async () => {
            const validationErrors =
              getEventForwarderValidationErrors(datasourceDraft);
            if (validationErrors.length) {
              // ErrorDisplay renders with pre-wrap, so each error gets a line.
              throw new Error(validationErrors.join("\n"));
            }
            // Unreachable once validation passes (a null config yields an
            // error above); the throw narrows the type for the request body.
            if (!eventForwarderConfig) {
              throw new Error(
                "Event Forwarder configuration is missing. Review the destination settings and try again.",
              );
            }
            try {
              await testEventForwarderAccess();
              await apiCall(`/datasource/${dataSource.id}/event-forwarder`, {
                method: "PUT",
                body: JSON.stringify({
                  eventForwarderConfig,
                }),
              });
            } catch (e) {
              throw e instanceof Error
                ? e
                : new Error(EVENT_FORWARDER_MODAL_FAILURE_MESSAGE);
            }

            onClearError();
            try {
              await onRefresh();
            } catch (e) {
              const detail = e instanceof Error ? ` ${e.message}` : "";
              onRefreshError(
                `Event Forwarder was saved, but the updated status could not be loaded.${detail}`,
              );
            }
            onCancel();
          }}
        >
          <SyncSubmittingRef submittingRef={isSubmittingRef} />
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
            <Button variant="ghost" onClick={attemptClose}>
              Cancel
            </Button>
            <EventForwarderConfirmButton
              usEventForwarderFlowConsent={usEventForwarderFlowConsent}
            />
          </Modal.Footer>
        </ModalForm>
      </Modal.Root>
      {showCloseConfirm ? (
        <ConfirmDialog
          title="Cancel event forwarder setup?"
          content="Event forwarder setup is still in progress. Closing this dialog won't cancel the in-flight request. Are you sure you want to close?"
          yesText="Close anyway"
          noText="Keep setup open"
          onConfirm={() => {
            setShowCloseConfirm(false);
            onCancel();
          }}
          onCancel={() => setShowCloseConfirm(false)}
        />
      ) : null}
    </>
  );
}

function EventForwarderSetupIndicator() {
  return (
    <Box
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-2)",
        width: "fit-content",
        padding: "2px 6px",
        borderRadius: "var(--radius-2)",
        backgroundColor: "var(--violet-a3)",
        color: "var(--violet-11)",
      }}
    >
      <LoadingSpinner style={{ width: "12px", height: "12px" }} />
      <Text size="small">Setting up</Text>
    </Box>
  );
}

export default function EventForwarder({
  dataSource,
  canEdit = true,
  onRefresh,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [pauseResumeLoading, setPauseResumeLoading] = useState(false);
  const { apiCall } = useAuth();
  const { effectiveAccountPlan, subscription, hasCommercialFeature } =
    useUser();
  const eventForwarderConfig = dataSource.eventForwarderConfig;
  const eventsForwarderFlag = useFeatureValue(
    "events-forwarder-multi-step",
    "OFF",
  );

  const isPaidPlan = ["pro", "pro_sso", "enterprise"].includes(
    effectiveAccountPlan || "",
  );
  const isStripePro = isPaidPlan && subscription?.billingPlatform === "stripe";
  const hasEventForwarderFeature = hasCommercialFeature("events-forwarder");

  const handleRefresh = useCallback(async () => {
    await onRefresh();
  }, [onRefresh]);

  const { isProvisioning, isError, pollTimedOut, taskErrors } =
    useEventForwarderProvisioningPoll({
      datasourceId: dataSource.id,
      status: eventForwarderConfig?.status,
      onRefresh: handleRefresh,
    });

  if (!supportsEventForwarder(dataSource)) {
    return null;
  }

  const isReady = eventForwarderConfig?.status === "ready";
  const isPaused = eventForwarderConfig?.status === "paused";
  const primaryConnectorErrorMessage = getPrimaryConnectorErrorMessage({
    actionError: error,
    lastProvisioningError: eventForwarderConfig?.lastProvisioningError,
    pollTimedOut,
    taskErrors,
  });
  const showProvisioningError =
    !isProvisioning &&
    (!!error ||
      (isError &&
        (eventForwarderConfig?.status === "error" ||
          eventForwarderConfig?.status === "schema_update_error" ||
          pollTimedOut ||
          !!primaryConnectorErrorMessage)));
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
            <Flex align="center" gap="2">
              {isProvisioning ? (
                <EventForwarderSetupIndicator />
              ) : (
                <Badge
                  label={statusLabels[eventForwarderConfig.status]}
                  color={statusColors[eventForwarderConfig.status]}
                  variant="soft"
                />
              )}
            </Flex>
          ) : null}
        </Flex>

        {canEdit && eventForwarderConfig ? (
          <Flex align="center" gap="2">
            <Button
              variant="outline"
              icon={<PiPencilSimple />}
              iconPosition="left"
              onClick={() => setShowEditModal(true)}
            >
              Edit
            </Button>
            {canToggle ? (
              <Button
                variant="outline"
                color={isReady ? "red" : undefined}
                icon={isReady ? <PiPause /> : <PiPlay />}
                iconPosition="left"
                loading={pauseResumeLoading}
                onClick={async () => {
                  setPauseResumeLoading(true);
                  try {
                    await apiCall(
                      `/datasource/${dataSource.id}/event-forwarder/${action}`,
                      { method: "POST" },
                    );
                    await onRefresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Action failed");
                  } finally {
                    setPauseResumeLoading(false);
                  }
                }}
              >
                {isReady ? "Pause" : "Resume"}
              </Button>
            ) : null}
          </Flex>
        ) : null}
      </Flex>

      <p>
        GrowthBook&apos;s Event Forwarder streams SDK event data from GrowthBook
        directly into this data source so you can query and analyze it alongside
        the rest of your warehouse data. More information available on our
        docs.&nbsp;
        <DocLink useRadix={false} docSection="eventForwarder">
          Event Forwarder Docs
        </DocLink>
      </p>

      {error && !eventForwarderConfig ? (
        <Callout status="error" mb="3">
          {error}
        </Callout>
      ) : null}

      {!eventForwarderConfig ? (
        eventsForwarderFlag === "VISIBLE" ? (
          <Callout status="info">
            Event Forwarder is available as an early access feature. Contact
            your account manager or reach out to{" "}
            <a
              href="mailto:sales@growthbook.io"
              target="_blank"
              rel="noreferrer"
            >
              sales@growthbook.io
            </a>{" "}
            to learn more and get started.
          </Callout>
        ) : hasEventForwarderFeature ? (
          <Callout status="info">
            Event Forwarder is not configured for this datasource.
            {canEdit ? (
              <Box mt="3">
                <Button color="inherit" onClick={() => setShowEditModal(true)}>
                  Set Up Event Forwarder
                </Button>
              </Box>
            ) : null}
          </Callout>
        ) : isStripePro ? (
          <Callout status="info">
            Event Forwarder is not available for your current plan. Contact your
            account manager or reach out to{" "}
            <a
              href="mailto:sales@growthbook.io"
              target="_blank"
              rel="noreferrer"
            >
              sales@growthbook.io
            </a>{" "}
            to upgrade.
          </Callout>
        ) : (
          <PremiumCallout
            commercialFeature="events-forwarder"
            id="event-forwarder-plan-gate"
          >
            Event Forwarder requires a Pro or Enterprise plan.
          </PremiumCallout>
        )
      ) : isPaused ? (
        <Callout status="info" mb="3">
          To remove the Event Forwarder, contact your account manager.
        </Callout>
      ) : null}

      {eventForwarderConfig ? (
        <Card>
          <Flex direction="column" gap="3" p="2">
            <Flex direction="column" gap="4">
              {eventForwarderConfig.sinkType === "bigquery" ? (
                <>
                  <EventForwarderConfigField
                    label="Project"
                    value={eventForwarderConfig.config.projectId}
                  />
                  <EventForwarderConfigField
                    label="Dataset"
                    value={eventForwarderConfig.config.dataset}
                  />
                  <EventForwarderConfigField
                    label="Table Prefix"
                    value={eventForwarderConfig.config.tablePrefix}
                    optional
                  />
                </>
              ) : null}
              {eventForwarderConfig.sinkType === "snowflake" ? (
                <>
                  <EventForwarderConfigField
                    label="Snowflake URL"
                    value={eventForwarderConfig.config.accessUrl}
                  />
                  <EventForwarderConfigField
                    label="Database"
                    value={eventForwarderConfig.config.database}
                  />
                  <EventForwarderConfigField
                    label="Schema"
                    value={eventForwarderConfig.config.schema}
                  />
                  <EventForwarderConfigField
                    label="Table Prefix"
                    value={eventForwarderConfig.config.tablePrefix}
                    optional
                  />
                  <EventForwarderConfigField
                    label="Role"
                    value={eventForwarderConfig.config.role}
                  />
                  <EventForwarderConfigField
                    label="Warehouse"
                    value={eventForwarderConfig.config.warehouse}
                    optional
                  />
                </>
              ) : null}
            </Flex>

            {isProvisioning ? (
              <Callout status="info">
                <Text color="text-mid" size="medium">
                  This page will update automatically once provisioning
                  completes.
                </Text>
              </Callout>
            ) : null}

            {showProvisioningError && primaryConnectorErrorMessage ? (
              <Callout status="error" mb="0">
                <Box style={{ whiteSpace: "pre-wrap" }}>
                  {primaryConnectorErrorMessage}
                </Box>
              </Callout>
            ) : null}
          </Flex>
        </Card>
      ) : null}
      {showEditModal ? (
        <EventForwarderModal
          dataSource={dataSource}
          onCancel={() => setShowEditModal(false)}
          onClearError={() => setError(null)}
          onRefresh={onRefresh}
          onRefreshError={setError}
        />
      ) : null}
    </Box>
  );
}
