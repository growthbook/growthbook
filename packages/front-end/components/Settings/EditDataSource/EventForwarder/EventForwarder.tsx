import {
  CSSProperties,
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  databricksParamsSupportEventForwarder,
  getDatabricksEventForwarderAuthMessage,
  DEFAULT_EVENT_FORWARDER_TABLE_PREFIX,
  normalizeBigQueryTablePrefixForEventForwarder,
  normalizeDatabricksEventForwarderDestination,
  normalizeDatabricksEventForwarderZerobusEndpoint,
  suggestDatabricksEventForwarderZerobusEndpoint,
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
import { DatabricksConnectionParams } from "shared/types/integrations/databricks";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import { dateNoYear, daysLeft, formatShortAgo } from "shared/dates";
import { Box, Card, Flex, Grid, Progress } from "@radix-ui/themes";
import {
  PiArrowClockwise,
  PiArrowUp,
  PiCaretRight,
  PiCheck,
  PiCopy,
  PiPause,
  PiTimer,
  PiTrash,
  PiPencilSimple,
  PiWarningOctagonFill,
  PiPlay,
} from "react-icons/pi";
import clsx from "clsx";
import { DailyUsage, UsageLimits } from "shared/types/organization";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import useApi from "@/hooks/useApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { isCloud } from "@/services/env";
import UsageMeter from "@/components/Settings/EditDataSource/EventForwarder/UsageMeter";
import EventForwarderActivity from "@/components/Settings/EditDataSource/EventForwarder/EventForwarderActivity";
import PremiumCallout from "@/ui/PremiumCallout";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import SelectField from "@/components/Forms/SelectField";
import BigQueryEventForwarderForm from "@/components/Settings/BigQueryEventForwarderForm";
import SnowflakeEventForwarderForm from "@/components/Settings/SnowflakeEventForwarderForm";
import DatabricksEventForwarderForm from "@/components/Settings/DatabricksEventForwarderForm";
import { useEventForwarderAccessTest } from "@/components/Settings/useEventForwarderAccessTest";
import {
  EventForwarderAllTakenCallout,
  EventForwarderNarrowingCallout,
  useEventForwarderAllTakenBy,
  EventForwarderEnvironmentField,
  EventForwarderLockedField,
} from "@/components/DataSourceSetup/EventForwarderDestinationFields";
import TextField from "@/ui/TextField";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import ExpandableBlock from "@/ui/ExpandableBlock";
import Checkbox from "@/ui/Checkbox";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import UITooltip from "@/ui/Tooltip";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Modal from "@/ui/Modal";
import ModalForm, { useModalForm } from "@/ui/Modal/ModalForm";
import ModalStandard, {
  focusFirstField,
} from "@/ui/Modal/Patterns/ModalStandard";
import LoadingSpinner from "@/components/LoadingSpinner";
import { DocLink } from "@/components/DocLink";
import {
  PROVISIONING_TIMEOUT_MESSAGE,
  useEventForwarderProvisioningPoll,
} from "@/components/Settings/EditDataSource/EventForwarder/useEventForwarderProvisioningPoll";
import {
  DEFAULT_DATA_REGION,
  DataRegion,
  getDataRegionLabel,
  useDataRegionOptions,
} from "@/services/dataRegions";
import styles from "./EventForwarder.module.scss";

type Props = {
  dataSource: DataSourceInterfaceWithParams;
  canEdit?: boolean;
  onRefresh: () => Promise<void>;
  /** Title the section when it isn't on its own Event Forwarder tab. */
  showTitle?: boolean;
  /** After a new forwarder is saved and the Data Source reloaded. */
  onCreated?: () => void;
};

type EventForwarderDatasourceDraft = {
  type: "bigquery" | "snowflake" | "databricks";
  params:
    | Partial<BigQueryConnectionParams>
    | Partial<SnowflakeConnectionParams>
    | Partial<DatabricksConnectionParams>;
  projects?: string[];
  eventForwarderConfig: EventForwarderConfigDraft | null;
};

const statusLabels: Record<EventForwarderStatus, string> = {
  unconfigured: "Not configured",
  pending: "Pending",
  ready: "Ready",
  paused: "Paused",
  error: "Errored",
  schema_update_error: "Schema update error",
};

const statusColors: Record<
  EventForwarderStatus,
  "gray" | "green" | "amber" | "red"
> = {
  unconfigured: "gray",
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
  lastProvisioningError,
  pollTimedOut,
  taskErrors,
}: {
  lastProvisioningError: string | undefined;
  pollTimedOut: boolean;
  taskErrors: EventForwarderStatusResponse["taskErrors"];
}): string | undefined {
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
  const environments = existing?.environments?.length
    ? { environments: existing.environments }
    : {};
  if (existing?.sinkType === "bigquery") {
    return {
      sinkType: "bigquery",
      region: existing.region,
      ...environments,
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
      region: existing.region,
      ...environments,
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
  if (existing?.sinkType === "databricks") {
    return {
      sinkType: "databricks",
      region: existing.region,
      ...environments,
      config: {
        catalog: existing.config.catalog,
        schema: existing.config.schema,
        tablePrefix: existing.config.tablePrefix,
        zerobusEndpoint: existing.config.zerobusEndpoint,
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
      region: "us-east-1",
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
      region: "us-east-1",
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
  if (dataSource.type === "databricks") {
    const params = dataSource.params as DatabricksConnectionParams;
    return {
      sinkType: "databricks",
      region: "us-east-1",
      config: {
        catalog: params.catalog || "",
        schema: "",
        tablePrefix: DEFAULT_EVENT_FORWARDER_TABLE_PREFIX,
        zerobusEndpoint: "",
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

  if (cfg.sinkType === "databricks") {
    const p = rawParams as Partial<DatabricksConnectionParams>;
    if (!databricksParamsSupportEventForwarder(p)) {
      errors.push(getDatabricksEventForwarderAuthMessage(p));
    }
    try {
      normalizeDatabricksEventForwarderDestination(cfg.config);
    } catch (e) {
      errors.push(
        e instanceof Error
          ? e.message
          : "Enter a valid catalog, schema and table prefix.",
      );
    }
    try {
      normalizeDatabricksEventForwarderZerobusEndpoint(
        cfg.config.zerobusEndpoint,
      );
    } catch (e) {
      errors.push(
        e instanceof Error ? e.message : "Enter a valid Zerobus endpoint.",
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
  wide = false,
}: {
  label: string;
  value: string | undefined;
  optional?: boolean;
  wide?: boolean;
}) {
  const trimmed = value?.trim();

  return (
    <Box gridColumn={wide ? "1 / -1" : undefined}>
      <Text size="sm" weight="medium" color="text-mid" mb="1">
        {optional ? `${label} (optional)` : label}
      </Text>
      {trimmed ? (
        <Text as="div" size="sm" weight="regular" color="text-high">
          {trimmed}
        </Text>
      ) : (
        <Text color="text-low" size="sm">
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
  editing,
  restartsOnSave,
  region,
  datasourceId,
}: {
  usEventForwarderFlowConsent: boolean;
  editing: boolean;
  restartsOnSave: boolean;
  region: DataRegion;
  datasourceId: string;
}) {
  const { loading } = useModalForm();
  const allTaken = !!useEventForwarderAllTakenBy(region, datasourceId);

  if (editing) {
    return (
      <Button type="submit" loading={loading}>
        {restartsOnSave ? "Save & restart" : "Save changes"}
      </Button>
    );
  }

  return (
    <UITooltip
      content={
        allTaken
          ? `Another Event Forwarder receives all environments in ${getDataRegionLabel(region)}. Choose another data region to continue.`
          : `Confirm that event data flows through GrowthBook's servers in ${getDataRegionLabel(region)} to continue.`
      }
      enabled={allTaken || !usEventForwarderFlowConsent}
      side="top"
    >
      <Button
        type="submit"
        disabled={allTaken || !usEventForwarderFlowConsent}
        loading={loading}
        icon={<PiCaretRight size={12} />}
        iconPosition="right"
      >
        Confirm
      </Button>
    </UITooltip>
  );
}

// Delete stays disabled until "confirm" is typed, case sensitive
function DeleteEventForwarderModal({
  datasourceId,
  onClose,
  onRefresh,
}: {
  datasourceId: string;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const { apiCall } = useAuth();
  const [confirmText, setConfirmText] = useState("");
  return (
    <ModalStandard
      open
      header="Delete Event Forwarder?"
      cta="Delete"
      ctaColor="red"
      ctaEnabled={confirmText === "confirm"}
      close={onClose}
      submit={async () => {
        await apiCall(`/datasource/${datasourceId}/event-forwarder`, {
          method: "DELETE",
        });
        await onRefresh();
      }}
      trackingEventModalType=""
    >
      <Flex direction="column" gap="3">
        <Text as="div">
          Once this Event Forwarder is deleted, events your SDKs keep sending
          are no longer forwarded and may be rejected with an error. Stop
          sending events from your SDKs first.
        </Text>
        <Text as="div">
          The tables already in your warehouse and the queries on this Data
          Source are kept.
        </Text>
        <TextField
          label={'Type "confirm" to delete (case sensitive)'}
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
        />
      </Flex>
    </ModalStandard>
  );
}

function EventForwarderModal({
  dataSource,
  onCancel,
  onRefresh,
  onClearError,
  onRefreshError,
  onCreated,
}: {
  dataSource: DataSourceInterfaceWithParams;
  onCancel: () => void;
  onRefresh: () => Promise<void>;
  onClearError: () => void;
  onRefreshError: (message: string) => void;
  onCreated?: () => void;
}) {
  const { apiCall } = useAuth();
  const isSubmittingRef = useRef(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const databricksParams =
    dataSource.params as Partial<DatabricksConnectionParams>;
  const dataRegionOptions = useDataRegionOptions();
  const [datasourceDraft, setDatasourceDraft] =
    useState<EventForwarderDatasourceDraft>(() => ({
      type: dataSource.type as EventForwarderDatasourceDraft["type"],
      params: {
        ...dataSource.params,
      } as EventForwarderDatasourceDraft["params"],
      projects: dataSource.projects,
      eventForwarderConfig: getEventForwarderDraft(dataSource),
    }));
  const saved = dataSource.eventForwarderConfig;
  const isEditingEventForwarder = !!saved;
  // Has received events, so its environments are locked
  const live =
    !!saved &&
    saved.status !== "unconfigured" &&
    !(saved.status === "error" && !saved.connectorName);
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
    : "Set up Event Forwarder";
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
        size="lg"
        // First field, not the label's help icon, whose tooltip would pop open
        onOpenAutoFocus={focusFirstField}
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
            let refreshed = false;
            try {
              await onRefresh();
              refreshed = true;
            } catch (e) {
              const detail = e instanceof Error ? ` ${e.message}` : "";
              onRefreshError(
                `Event Forwarder was saved, but the updated status could not be loaded.${detail}`,
              );
            }
            onCancel();
            // Its tab only exists once the reload shows it; else stay on the error
            if (!isEditingEventForwarder && refreshed) onCreated?.();
          }}
        >
          <SyncSubmittingRef submittingRef={isSubmittingRef} />
          <Modal.Header>
            <Modal.Title>{modalTitle}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Flex direction="column" gap="4">
              {eventForwarderConfig?.sinkType === "bigquery" ? (
                <BigQueryEventForwarderForm
                  eventForwarderConfig={eventForwarderConfig}
                  setEventForwarderConfig={setEventForwarderConfig}
                />
              ) : null}
              {eventForwarderConfig?.sinkType === "snowflake" ? (
                <SnowflakeEventForwarderForm
                  eventForwarderConfig={eventForwarderConfig}
                  setEventForwarderConfig={setEventForwarderConfig}
                />
              ) : null}
              {eventForwarderConfig?.sinkType === "databricks" ? (
                <DatabricksEventForwarderForm
                  eventForwarderConfig={eventForwarderConfig}
                  setEventForwarderConfig={setEventForwarderConfig}
                  catalogReadOnly={!!databricksParams.catalog}
                  zerobusPlaceholder={
                    suggestDatabricksEventForwarderZerobusEndpoint(
                      databricksParams.host,
                    ) ||
                    "https://<workspace-id>.zerobus.<region>.cloud.databricks.com"
                  }
                />
              ) : null}
              {eventForwarderConfig ? (
                <EventForwarderAllTakenCallout
                  region={eventForwarderConfig.region ?? DEFAULT_DATA_REGION}
                  datasourceId={dataSource.id}
                  regionSelectable={!isEditingEventForwarder}
                />
              ) : null}
              {eventForwarderConfig ? (
                <Grid columns="2" gap="4" align="start">
                  <Box>
                    <EventForwarderEnvironmentField
                      markRequired={false}
                      // Single select for now, saved as a one-item list
                      value={eventForwarderConfig.environments?.[0] ?? ""}
                      region={
                        eventForwarderConfig.region ?? DEFAULT_DATA_REGION
                      }
                      datasourceId={dataSource.id}
                      live={live}
                      onChange={(environment) =>
                        setEventForwarderConfig({
                          ...eventForwarderConfig,
                          environments: environment ? [environment] : [],
                        })
                      }
                    />
                  </Box>
                  {isEditingEventForwarder ? (
                    <EventForwarderLockedField
                      label="Data region"
                      value={getDataRegionLabel(
                        eventForwarderConfig.region ?? DEFAULT_DATA_REGION,
                      )}
                      helpText="Where GrowthBook processes event data before writing to your warehouse. Set at creation."
                    />
                  ) : (
                    <SelectField
                      size="md"
                      legacyLabelFormatting={false}
                      label="Data region"
                      value={eventForwarderConfig.region ?? DEFAULT_DATA_REGION}
                      onChange={(value) => {
                        setEventForwarderConfig({
                          ...eventForwarderConfig,
                          region: value as DataRegion,
                        });
                        setUsEventForwarderFlowConsent(false);
                      }}
                      options={dataRegionOptions}
                      helpText="Where GrowthBook processes event data before writing to your warehouse. Can't be changed later."
                    />
                  )}
                </Grid>
              ) : null}
              {eventForwarderConfig ? (
                <EventForwarderNarrowingCallout
                  value={eventForwarderConfig.environments?.[0] ?? ""}
                  region={eventForwarderConfig.region ?? DEFAULT_DATA_REGION}
                  datasourceId={dataSource.id}
                  live={live}
                />
              ) : null}
              {isEditingEventForwarder ? (
                <Callout status="info" mb="0">
                  {`Event data flows through GrowthBook's servers in ${getDataRegionLabel(
                    eventForwarderConfig?.region ?? DEFAULT_DATA_REGION,
                  )}. Your organization authorized this when the Event Forwarder was created.`}
                </Callout>
              ) : (
                <Callout status="info" mb="0" icon={null}>
                  <Checkbox
                    value={usEventForwarderFlowConsent}
                    setValue={setUsEventForwarderFlowConsent}
                    label={`I understand that event data will flow through GrowthBook's servers in ${getDataRegionLabel(
                      eventForwarderConfig?.region ?? DEFAULT_DATA_REGION,
                    )} and confirm I'm authorized to enable this for my organization.`}
                    weight="regular"
                  />
                </Callout>
              )}
            </Flex>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" onClick={attemptClose}>
              Cancel
            </Button>
            <EventForwarderConfirmButton
              usEventForwarderFlowConsent={usEventForwarderFlowConsent}
              editing={isEditingEventForwarder}
              // Saving a stopped forwarder restarts it server-side.
              restartsOnSave={
                saved?.status === "error" && !!saved.connectorName
              }
              region={eventForwarderConfig?.region ?? DEFAULT_DATA_REGION}
              datasourceId={dataSource.id}
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

const sinkLabels = {
  bigquery: "BigQuery",
  snowflake: "Snowflake",
  databricks: "Databricks",
} as const;

const ERROR_COLLAPSED_LINES = 3;
const ERROR_LINE_HEIGHT_PX = 20;

// Collapsed past three lines; traces keep their line breaks.
function EventForwarderLastError({
  source,
  message,
}: {
  source: string;
  message: string;
}) {
  const { copySupported, copySuccess, performCopy } = useCopyToClipboard({
    timeout: 1500,
  });
  return (
    <Card mb="3">
      <Flex direction="column" gap="3" p="2">
        <Flex align="center" justify="between" gap="3">
          <Heading as="h4" size="sm" mb="0">
            Last Error from {source}
          </Heading>
          {copySupported ? (
            <Button
              variant="outline"
              size="sm"
              icon={copySuccess ? <PiCheck /> : <PiCopy />}
              iconPosition="left"
              onClick={() => performCopy(message)}
            >
              <span aria-live="polite">
                {copySuccess ? "Copied" : "Copy error"}
              </span>
            </Button>
          ) : null}
        </Flex>
        <Box
          style={{
            padding: "var(--space-3)",
            borderRadius: "var(--radius-2)",
            backgroundColor: "var(--gray-a2)",
          }}
        >
          <ExpandableBlock
            maxHeight={ERROR_COLLAPSED_LINES * ERROR_LINE_HEIGHT_PX}
          >
            <Box
              style={{
                fontFamily: "var(--code-font-family)",
                fontSize: "var(--font-size-2)",
                lineHeight: `${ERROR_LINE_HEIGHT_PX}px`,
                whiteSpace: "pre-wrap",
                // Long URLs/IDs have no spaces to wrap on.
                overflowWrap: "anywhere",
              }}
            >
              {message}
            </Box>
          </ExpandableBlock>
        </Box>
      </Flex>
    </Card>
  );
}

const BACKLOG_RETENTION_DAYS = 90;
const DELETION_WARNING_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function EventForwarderStoppedBanner({
  backlogCount,
  erroredAt,
  lastPolledAt,
  canEdit,
  restarting,
  onEdit,
  onRestart,
}: {
  backlogCount: number;
  erroredAt: string | null;
  lastPolledAt: number | null;
  canEdit: boolean;
  restarting: boolean;
  onEdit: () => void;
  onRestart: () => void;
}) {
  // Counts the "… ago" times up each second; no refetch.
  const [, setTick] = useState(0);
  useEffect(() => {
    const intervalId = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(intervalId);
  }, []);
  // Highlights the count when it changes; the first count loading in is not a change.
  const [flash, setFlash] = useState(false);
  const prevCount = useRef(backlogCount);
  useEffect(() => {
    const changed = prevCount.current > 0 && backlogCount !== prevCount.current;
    prevCount.current = backlogCount;
    if (!changed) return;
    setFlash(true);
    const timeoutId = window.setTimeout(() => setFlash(false), 700);
    return () => window.clearTimeout(timeoutId);
  }, [backlogCount]);
  const hasBacklog = backlogCount > 0;
  // S3 expires an object at the first UTC midnight after it turns 90 days old.
  const deletionStartsAt = erroredAt
    ? new Date(
        (Math.floor(new Date(erroredAt).getTime() / DAY_MS) +
          BACKLOG_RETENTION_DAYS +
          1) *
          DAY_MS,
      )
    : null;
  const daysToDeletion = deletionStartsAt ? daysLeft(deletionStartsAt) : null;
  const deleting =
    hasBacklog &&
    deletionStartsAt !== null &&
    deletionStartsAt.getTime() <= Date.now();
  const approaching =
    hasBacklog &&
    !deleting &&
    daysToDeletion !== null &&
    daysToDeletion <= DELETION_WARNING_DAYS;
  const deletionDate = deletionStartsAt ? dateNoYear(deletionStartsAt) : "";

  const headline = deleting
    ? "The oldest queued events are being deleted."
    : approaching
      ? `Queued events start being deleted in ${
          !daysToDeletion
            ? "less than a day"
            : `${daysToDeletion} ${daysToDeletion === 1 ? "day" : "days"}`
        }.`
      : "Events are queuing.";
  const guidance = deleting
    ? `Each day, events older than ${BACKLOG_RETENTION_DAYS} days are deleted and can't be recovered. Fix the destination, then restart to send what's left.`
    : approaching
      ? `Fix the destination and restart before ${deletionDate} to keep every queued event.`
      : `Nothing is lost yet. Fix the destination, then restart to send queued events. Queued events are kept for ${BACKLOG_RETENTION_DAYS} days.`;
  const details = [
    !deleting && erroredAt
      ? `Oldest from ${formatShortAgo(new Date(erroredAt))}`
      : null,
    lastPolledAt ? `Updated ${formatShortAgo(lastPolledAt)}` : null,
  ].filter((d) => d !== null);

  return (
    <Callout
      status="error"
      mb="3"
      icon={<PiWarningOctagonFill />}
      style={
        {
          "--stopped-border": `var(--red-${deleting || approaching ? 7 : 6})`,
          boxShadow: "inset 0 0 0 1px var(--stopped-border)",
        } as CSSProperties
      }
    >
      <Flex direction="column" gap="3">
        <Box style={{ color: "var(--red-12)" }}>
          <Text as="div" weight="semibold">
            Forwarding stopped. {headline}
          </Text>
        </Box>
        {hasBacklog ? (
          <Box className={styles.queueStats}>
            <Flex align="center" gap="3" wrap="wrap" px="3" py="2">
              <span
                aria-hidden
                className={clsx(
                  styles.dot,
                  !deleting && !approaching && styles.dotLive,
                )}
              />
              <Text weight="semibold" color="text-high">
                <span aria-live="polite">
                  <span
                    className={clsx(styles.count, flash && styles.countFlash)}
                  >
                    {backlogCount.toLocaleString()}{" "}
                    {backlogCount === 1 ? "event" : "events"} queued
                  </span>
                </span>
              </Text>
              {details.map((detail) => (
                <Fragment key={detail.split(" ")[0]}>
                  <Text color="text-mid">·</Text>
                  {/* Ticks every second; keep it out of the alert's announcements. */}
                  <span aria-live="off">
                    <Text color="text-mid">{detail}</Text>
                  </span>
                </Fragment>
              ))}
            </Flex>
            {approaching ? (
              <Flex
                align="center"
                gap="2"
                px="3"
                py="2"
                className={styles.deletionNotice}
              >
                <PiTimer style={{ flexShrink: 0 }} />
                <span>
                  <strong>From {deletionDate},</strong> events older than{" "}
                  {BACKLOG_RETENTION_DAYS} days are deleted each day.
                </span>
              </Flex>
            ) : null}
          </Box>
        ) : null}
        <Text as="div" color="text-high">
          {guidance}
        </Text>
        {canEdit ? (
          <Flex align="center" gap="2" wrap="wrap">
            <Button
              variant="outline"
              icon={<PiPencilSimple />}
              iconPosition="left"
              style={{ backgroundColor: "var(--color-panel-solid)" }}
              onClick={onEdit}
            >
              Edit destination
            </Button>
            <Button
              icon={<PiArrowClockwise />}
              iconPosition="left"
              loading={restarting}
              onClick={onRestart}
            >
              Restart forwarding
            </Button>
          </Flex>
        ) : null}
      </Flex>
    </Callout>
  );
}

export default function EventForwarder({
  dataSource,
  canEdit = true,
  onRefresh,
  showTitle = false,
  onCreated,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [pauseResumeLoading, setPauseResumeLoading] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const { apiCall } = useAuth();
  const { effectiveAccountPlan, subscription, hasCommercialFeature, usage } =
    useUser();
  const permissionsUtil = usePermissionsUtil();
  const eventForwarderConfig = dataSource.eventForwarderConfig;
  const isMetered =
    isCloud() && !hasCommercialFeature("unlimited-event-forwarder-usage");
  const { data: usageData } = useApi<{
    usage: DailyUsage[];
    limits: UsageLimits;
  }>("/billing/usage?monthsAgo=0", {
    shouldRun: () =>
      isMetered && !!eventForwarderConfig && permissionsUtil.canViewUsage(),
  });
  const forwarderLimit = usageData?.limits.eventForwarderEvents;
  const forwardedThisMonth =
    usageData?.usage.reduce((sum, u) => sum + u.eventForwarderEvents, 0) ?? 0;
  // "over" is the advertised stop (what the nav and docs say); the hidden
  // `blocked` flag is enforced server-side and needs nothing here.
  const isOverLimit = isMetered && usage?.eventForwarder?.status === "over";

  const isPaidPlan = ["pro", "pro_sso", "enterprise"].includes(
    effectiveAccountPlan || "",
  );
  const isStripePro = isPaidPlan && subscription?.billingPlatform === "stripe";
  const hasEventForwarderFeature = hasCommercialFeature("events-forwarder");

  const handleRefresh = useCallback(async () => {
    await onRefresh();
  }, [onRefresh]);

  const {
    isProvisioning,
    isError,
    pollTimedOut,
    taskErrors,
    backlogCount,
    replaying,
    replayedCount,
    erroredAt,
    lastPolledAt,
  } = useEventForwarderProvisioningPoll({
    datasourceId: dataSource.id,
    status: eventForwarderConfig?.status,
    onRefresh: handleRefresh,
  });

  if (!isCloud() || !supportsEventForwarder(dataSource)) {
    return null;
  }

  const isReady = eventForwarderConfig?.status === "ready";
  const isPaused = eventForwarderConfig?.status === "paused";
  // The destination's own error; action failures show on their own.
  const destinationErrorMessage = getPrimaryConnectorErrorMessage({
    lastProvisioningError: eventForwarderConfig?.lastProvisioningError,
    pollTimedOut,
    taskErrors,
  });
  const showDestinationError =
    !isProvisioning && isError && !!destinationErrorMessage;
  // Errored after it was forwarding; a failed setup has no connector.
  const forwardingStopped =
    !isProvisioning &&
    eventForwarderConfig?.status === "error" &&
    !!eventForwarderConfig.connectorName;
  // Pause/Resume stay available while usage-blocked; a resume takes effect on the 1st
  const canToggle = canEdit && (isReady || isPaused);
  // Restart replaces Pause once the destination errored; without a connector
  // there is nothing to restart, so Edit is the retry path.
  const canRestart = canEdit && forwardingStopped;
  const hasBacklog = backlogCount > 0;
  const replayTotal = replayedCount + backlogCount;
  const replayPct = replayTotal
    ? Math.floor((replayedCount / replayTotal) * 100)
    : 0;
  const replayLabel = `${replayedCount.toLocaleString()} of ${replayTotal.toLocaleString()} events`;
  // A restart with nothing queued has no progress to show.
  const showReplay = isProvisioning && replaying && replayTotal > 0;
  const countPill = (label: string, color: "red" | "violet") => (
    <Badge label={label} color={color} variant="solid" radius="full" mr="1" />
  );
  const action = canRestart ? "restart" : isReady ? "pause" : "resume";
  const actionButton = {
    restart: { label: "Restart", icon: <PiArrowClockwise /> },
    pause: { label: "Pause", icon: <PiPause />, color: "red" as const },
    resume: { label: "Resume", icon: <PiPlay /> },
  }[action];
  const databricksParams =
    dataSource.params as Partial<DatabricksConnectionParams>;
  const databricksAuthBlocked =
    dataSource.type === "databricks" &&
    !databricksParamsSupportEventForwarder(databricksParams);
  const databricksAuthMessage =
    getDatabricksEventForwarderAuthMessage(databricksParams);
  const runAction = async () => {
    setError(null);
    setPauseResumeLoading(true);
    try {
      await apiCall(`/datasource/${dataSource.id}/event-forwarder/${action}`, {
        method: "POST",
      });
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setPauseResumeLoading(false);
    }
  };

  return (
    <Box>
      {showTitle || eventForwarderConfig ? (
        <Flex align="center" justify="between" gap="3" mb="2">
          <Flex align="center" gap="2">
            {showTitle ? (
              <Heading as="h3" size="md" mb="0">
                Event Forwarder
              </Heading>
            ) : (
              <Text weight="semibold">Status</Text>
            )}
            {!eventForwarderConfig ? null : isProvisioning ? (
              <Badge
                color="violet"
                variant="soft"
                label={
                  <Flex align="center" gap="2">
                    <LoadingSpinner style={{ width: "12px", height: "12px" }} />
                    {showReplay ? "Writing backlog" : "Setting up"}
                  </Flex>
                }
              />
            ) : (
              <>
                <Badge
                  label={statusLabels[eventForwarderConfig.status]}
                  color={statusColors[eventForwarderConfig.status]}
                  variant="soft"
                />
                {isOverLimit ? (
                  <Badge label="Limit reached" color="red" variant="soft" />
                ) : null}
              </>
            )}
          </Flex>

          {/* One group, so the header's space-between keeps them together */}
          <Flex align="center" gap="2">
            {/* Restart sits in the stopped banner instead */}
            {canToggle ? (
              <Button
                variant="outline"
                color={"color" in actionButton ? actionButton.color : undefined}
                icon={actionButton.icon}
                iconPosition="left"
                loading={pauseResumeLoading}
                onClick={runAction}
              >
                {actionButton.label}
              </Button>
            ) : null}
            {/* Running forwarders show it disabled, so deletion is discoverable */}
            {canEdit && (isReady || isPaused) ? (
              <UITooltip
                content="Pause the Event Forwarder before deleting it."
                enabled={!isPaused}
                side="top"
              >
                <Button
                  variant="outline"
                  color="red"
                  icon={<PiTrash />}
                  iconPosition="left"
                  disabled={!isPaused}
                  onClick={() => setShowDelete(true)}
                >
                  Delete
                </Button>
              </UITooltip>
            ) : null}
          </Flex>
        </Flex>
      ) : null}
      <p>
        GrowthBook&apos;s Event Forwarder streams SDK event data from GrowthBook
        directly into this data source so you can query and analyze it alongside
        the rest of your warehouse data. More information available on our
        docs.&nbsp;
        <DocLink useRadix={false} docSection="eventForwarder">
          Event Forwarder Docs
        </DocLink>
      </p>

      {showDelete ? (
        <DeleteEventForwarderModal
          datasourceId={dataSource.id}
          onClose={() => setShowDelete(false)}
          onRefresh={onRefresh}
        />
      ) : null}

      {error ? (
        <Callout status="error" mb="3">
          {error}
        </Callout>
      ) : null}

      {eventForwarderConfig && forwardingStopped ? (
        <EventForwarderStoppedBanner
          backlogCount={backlogCount}
          erroredAt={erroredAt}
          lastPolledAt={lastPolledAt}
          canEdit={canEdit}
          restarting={pauseResumeLoading}
          onEdit={() => setShowEditModal(true)}
          onRestart={runAction}
        />
      ) : null}

      {eventForwarderConfig && showDestinationError ? (
        <EventForwarderLastError
          source={sinkLabels[eventForwarderConfig.sinkType]}
          message={destinationErrorMessage}
        />
      ) : null}

      {showReplay ? (
        <Flex
          role="status"
          direction="column"
          gap="2"
          px="4"
          py="3"
          mb="3"
          style={{
            backgroundColor: "var(--violet-a3)",
            borderRadius: "var(--radius-3)",
          }}
        >
          <Flex align="center" gap="2">
            <PiArrowUp
              size={16}
              color="var(--violet-11)"
              style={{ flexShrink: 0 }}
            />
            <Text weight="semibold">
              Writing backed-up events to your warehouse.
            </Text>
          </Flex>
          {/* The total grows while new events are parked behind the replay. */}
          <Flex
            align="baseline"
            justify="between"
            gap="3"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            <Text>{replayLabel}</Text>
            <Text weight="medium">{replayPct}%</Text>
          </Flex>
          <Progress
            value={replayPct}
            color="violet"
            size="1"
            aria-label="Backed-up events written"
            getValueLabel={() => replayLabel}
          />
          <Text size="sm" color="text-mid">
            New events wait until this is done, then forwarding resumes.
          </Text>
        </Flex>
      ) : null}

      {hasBacklog && isReady && !isProvisioning ? (
        <Callout status="info" mb="3">
          Writing backed-up events to your warehouse:{" "}
          {countPill(`${backlogCount.toLocaleString()} left`, "violet")}
        </Callout>
      ) : null}

      {databricksAuthBlocked ? (
        <Callout status="warning" mb="3">
          {databricksAuthMessage}
        </Callout>
      ) : null}

      {eventForwarderConfig && isOverLimit ? (
        <Callout
          status="error"
          mb="3"
          action={
            <Button color="inherit" onClick={() => setShowUpgrade(true)}>
              Upgrade
            </Button>
          }
        >
          Monthly event limit reached. Forwarding has stopped until the 1st or
          until you upgrade, and events received meanwhile are not delivered.
          {isPaused
            ? " It is also paused. You can resume it now; forwarding restarts once the limit clears."
            : ""}
        </Callout>
      ) : null}
      {showUpgrade ? (
        <UpgradeModal
          close={() => setShowUpgrade(false)}
          source="event-forwarder-card-usage-blocked"
          commercialFeature="unlimited-event-forwarder-usage"
        />
      ) : null}

      {!eventForwarderConfig ? (
        hasEventForwarderFeature ? (
          <Callout status="info">
            Event Forwarder is not configured for this datasource.
            {canEdit ? (
              <Box mt="3">
                <Button
                  color="inherit"
                  disabled={databricksAuthBlocked}
                  onClick={() => setShowEditModal(true)}
                >
                  Set Up Event Forwarder
                </Button>
              </Box>
            ) : null}
          </Callout>
        ) : isStripePro ? (
          <Callout status="info">
            Event Forwarder is not available for your current plan. Contact your
            account manager or reach out to{" "}
            <Link href="mailto:sales@growthbook.io">sales@growthbook.io</Link>{" "}
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

      {eventForwarderConfig && isProvisioning && !showReplay ? (
        <Callout status="info" mb="3">
          <Text color="text-mid" size="md">
            This page will update automatically once provisioning completes.
          </Text>
        </Callout>
      ) : null}

      {eventForwarderConfig && typeof forwarderLimit === "number" ? (
        <Box mb="4">
          <UsageMeter
            used={forwardedThisMonth}
            limit={forwarderLimit}
            noun="events"
          />
        </Box>
      ) : null}

      {(isReady || isPaused) && !isProvisioning ? (
        <EventForwarderActivity
          dataSource={dataSource}
          isPaused={isPaused}
          isOverLimit={isOverLimit}
        />
      ) : null}
      {eventForwarderConfig ? (
        <Card>
          <Flex direction="column" gap="3" p="2">
            <Flex align="center" justify="between" gap="3">
              <Heading as="h4" size="sm" mb="0">
                Destination
              </Heading>
              {canEdit ? (
                <Button
                  variant="outline"
                  icon={<PiPencilSimple />}
                  iconPosition="left"
                  onClick={() => setShowEditModal(true)}
                >
                  Edit
                </Button>
              ) : null}
            </Flex>
            {/* Same grid as the edit form */}
            <Grid columns="2" gap="4" align="start">
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
                    label="Table prefix"
                    value={eventForwarderConfig.config.tablePrefix}
                    optional
                    wide
                  />
                </>
              ) : null}
              {eventForwarderConfig.sinkType === "snowflake" ? (
                <>
                  <EventForwarderConfigField
                    label="Snowflake access URL"
                    value={eventForwarderConfig.config.accessUrl}
                    wide
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
                    label="Table prefix"
                    value={eventForwarderConfig.config.tablePrefix}
                    optional
                  />
                  <EventForwarderConfigField
                    label="Warehouse"
                    value={eventForwarderConfig.config.warehouse}
                    optional
                  />
                  <EventForwarderConfigField
                    label="Role"
                    value={eventForwarderConfig.config.role}
                    wide
                  />
                </>
              ) : null}
              {eventForwarderConfig.sinkType === "databricks" ? (
                <>
                  <EventForwarderConfigField
                    label="Catalog"
                    value={eventForwarderConfig.config.catalog}
                    wide
                  />
                  <EventForwarderConfigField
                    label="Schema"
                    value={eventForwarderConfig.config.schema}
                  />
                  <EventForwarderConfigField
                    label="Table prefix"
                    value={eventForwarderConfig.config.tablePrefix}
                    optional
                  />
                  <EventForwarderConfigField
                    label="Zerobus endpoint"
                    value={eventForwarderConfig.config.zerobusEndpoint}
                    wide
                  />
                </>
              ) : null}
              <EventForwarderConfigField
                label={
                  (eventForwarderConfig.environments?.length ?? 0) > 1
                    ? "Environments"
                    : "Environment"
                }
                value={
                  eventForwarderConfig.environments?.join(", ") ||
                  "All Environments"
                }
              />
              <EventForwarderConfigField
                label="Data region"
                value={getDataRegionLabel(
                  eventForwarderConfig.region ?? DEFAULT_DATA_REGION,
                )}
              />
            </Grid>
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
          onCreated={onCreated}
        />
      ) : null}
    </Box>
  );
}
