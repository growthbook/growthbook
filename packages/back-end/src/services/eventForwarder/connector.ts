import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { DatabricksConnectionParams } from "shared/types/integrations/databricks";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import {
  BigQueryEventForwarderStoredConfig,
  DatabricksEventForwarderStoredConfig,
  EventForwarderSinkType,
  EventForwarderStatus,
  SnowflakeEventForwarderStoredConfig,
} from "shared/types/event-forwarder";
import { EventForwarderDatasourceParams } from "shared/util";
import {
  EventForwarderConfigInterface,
  EventForwarderConnectorPhase,
  EventForwarderStatusResponse,
} from "shared/validators";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  postPauseEventForwarderToLicenseServer,
  postProvisionEventForwarderToLicenseServer,
  postRestartEventForwarderToLicenseServer,
  postResumeEventForwarderToLicenseServer,
  postTeardownEventForwarderToLicenseServer,
  postUpdateEventForwarderCredentialsToLicenseServer,
  EventForwarderLicenseConnectorPhase,
  EventForwarderLicenseConnectorStatus,
  postEventForwarderStatusToLicenseServer,
} from "back-end/src/enterprise/licenseUtil";
import {
  decryptEventForwarderConfigModel,
  getBigQueryEventForwarderProjectId,
  isInHouseConsumerSink,
} from "back-end/src/services/eventForwarder/config";
import {
  ensureEventForwarderBigQueryTables,
  resolveBigQueryEventForwarderTablePrefix,
} from "back-end/src/services/eventForwarder/bigquery";
import { ensureEventForwarderDatabricksTables } from "back-end/src/services/eventForwarder/databricks";
import { ensureEventForwarderFeatureUsageQuery } from "back-end/src/services/eventForwarder/datasourceQueries";
import { reconcileEventForwarderDatasourceUserIdTypesAndExposureQueries } from "back-end/src/services/eventForwarder/datasourceSync";
import { ensureEventForwarderEventsFactTable } from "back-end/src/services/eventForwarder/factTable";
import { queueDelayedEventForwarderWarehouseSyncForDatasource } from "back-end/src/services/eventForwarder/warehouseSync";
import {
  assertEventForwarderWriteAccessResult,
  testEventForwarderWriteAccess,
} from "back-end/src/services/eventForwarder/writeAccess";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";

// ---------------------------------------------------------------------------
// Connector status sync
// ---------------------------------------------------------------------------

export function mapLicenseConnectorPhaseToEventForwarderStatus(
  phase: EventForwarderLicenseConnectorPhase,
): EventForwarderStatus {
  switch (phase) {
    case "ready":
      return "ready";
    case "error":
      return "error";
    case "paused":
      return "paused";
    case "provisioning":
    default:
      return "pending";
  }
}

export function buildEventForwarderStatusResponse(
  connectorStatus: EventForwarderLicenseConnectorStatus,
): EventForwarderStatusResponse {
  const status = mapLicenseConnectorPhaseToEventForwarderStatus(
    connectorStatus.phase,
  );
  return {
    status,
    phase: connectorStatus.phase as EventForwarderConnectorPhase,
    message: connectorStatus.message,
    confluentState: connectorStatus.confluentState,
    taskErrors: connectorStatus.taskErrors,
  };
}

function hasInitialWarehouseSyncQueued(
  eventForwarderConfig: EventForwarderConfigInterface,
): boolean {
  return eventForwarderConfig.initialWarehouseSyncQueued === true;
}

async function queueInitialWarehouseSyncIfNeeded(
  context: ReqContext,
  eventForwarderConfig: EventForwarderConfigInterface,
): Promise<boolean> {
  if (hasInitialWarehouseSyncQueued(eventForwarderConfig)) {
    return false;
  }

  try {
    await queueDelayedEventForwarderWarehouseSyncForDatasource(
      context,
      eventForwarderConfig.datasourceId,
    );
    await context.models.eventForwarderConfigs.update(eventForwarderConfig, {
      initialWarehouseSyncQueued: true,
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error(
      {
        eventForwarderConfigId: eventForwarderConfig.id,
        organizationId: context.org.id,
        datasourceId: eventForwarderConfig.datasourceId,
        error: message,
      },
      "Failed to queue initial event forwarder warehouse sync",
    );
    return false;
  }
}

export async function syncEventForwarderStatusFromLicenseServer(
  context: ReqContext,
  eventForwarderConfig: EventForwarderConfigInterface,
): Promise<EventForwarderStatusResponse> {
  const connectorName = eventForwarderConfig.connectorName?.trim();
  if (!connectorName) {
    return {
      status: "pending",
      phase: "provisioning",
      message: "Waiting for connector",
    };
  }

  const connectorStatus = await postEventForwarderStatusToLicenseServer({
    organizationId: context.org.id,
    datasourceId: eventForwarderConfig.datasourceId,
    connectorName,
  });

  const response = buildEventForwarderStatusResponse(connectorStatus);

  if (response.status === "ready") {
    const lastProvisioningError = "";
    if (
      eventForwarderConfig.status !== "ready" ||
      eventForwarderConfig.lastProvisioningError !== lastProvisioningError
    ) {
      await context.models.eventForwarderConfigs.update(eventForwarderConfig, {
        status: "ready",
        lastProvisioningError,
      });
    }

    await queueInitialWarehouseSyncIfNeeded(context, eventForwarderConfig);
  } else if (response.status === "error") {
    const lastProvisioningError =
      response.message || "Event forwarder connector failed";
    if (
      eventForwarderConfig.status !== "error" ||
      eventForwarderConfig.lastProvisioningError !== lastProvisioningError
    ) {
      await context.models.eventForwarderConfigs.update(eventForwarderConfig, {
        status: "error",
        lastProvisioningError,
      });
    }
  } else if (response.status === "paused") {
    const lastProvisioningError = "";
    if (
      eventForwarderConfig.status !== "paused" ||
      eventForwarderConfig.lastProvisioningError !== lastProvisioningError
    ) {
      await context.models.eventForwarderConfigs.update(eventForwarderConfig, {
        status: "paused",
        lastProvisioningError,
      });
    }
  } else if (eventForwarderConfig.status !== "pending") {
    await context.models.eventForwarderConfigs.update(eventForwarderConfig, {
      status: "pending",
    });
  }

  return response;
}

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

/**
 * Provisions Confluent resources for an event forwarder via the central license server.
 * Updates the Mongo document on success or error; throws after persisting error state.
 */
export async function provisionEventForwarderThroughLicenseServer(
  context: ReqContext,
  eventForwarderConfig: EventForwarderConfigInterface | null,
  datasourceParams?: EventForwarderDatasourceParams,
  options?: { restartAfterProvision?: boolean },
): Promise<void> {
  if (!eventForwarderConfig) {
    return;
  }

  try {
    const attributeSchema = context.org.settings?.attributeSchema ?? [];
    const datasource = await getDataSourceById(
      context,
      eventForwarderConfig.datasourceId,
    );
    if (!datasource) {
      throw new Error("Cannot find data source for event forwarder");
    }
    let result: {
      schemaId: number;
      connectorName: string;
      connectorId: string;
    };

    switch (eventForwarderConfig.sinkType) {
      case "bigquery": {
        const bigqueryConnectionParams = datasourceParams as
          | BigQueryConnectionParams
          | undefined;
        if (!bigqueryConnectionParams) {
          throw new Error(
            "Missing BigQuery Data Source params for Event Forwarder provisioning",
          );
        }
        const decrypted =
          decryptEventForwarderConfigModel<BigQueryEventForwarderStoredConfig>(
            eventForwarderConfig,
          );
        const projectId = getBigQueryEventForwarderProjectId(
          decrypted,
          bigqueryConnectionParams,
        );

        if (!projectId) {
          throw new Error(
            "Missing BigQuery connector project id for event forwarder provisioning",
          );
        }

        const tablePrefix =
          await resolveBigQueryEventForwarderTablePrefix(eventForwarderConfig);

        assertEventForwarderWriteAccessResult(
          await testEventForwarderWriteAccess(context, {
            sinkType: "bigquery",
            datasource,
            params: bigqueryConnectionParams,
            config: decrypted,
          }),
        );

        await ensureEventForwarderBigQueryTables({
          datasourceParams: bigqueryConnectionParams,
          projectId,
          dataset: decrypted.dataset.trim(),
          tablePrefix,
          serviceAccountKey: decrypted.serviceAccountKey,
        });

        result = await postProvisionEventForwarderToLicenseServer({
          organizationId: context.org.id,
          datasourceId: eventForwarderConfig.datasourceId,
          topic: eventForwarderConfig.topic,
          sinkType: "bigquery",
          bigqueryProjectId: projectId,
          tablePrefix,
          bigqueryDataset: decrypted.dataset.trim(),
          serviceAccountKeyJson: (decrypted.serviceAccountKey ?? "").trim(),
          attributeSchema,
          connectorName:
            eventForwarderConfig.connectorName?.trim() || undefined,
          connectorId: eventForwarderConfig.connectorId?.trim() || undefined,
        });
        break;
      }
      case "snowflake": {
        const decrypted =
          decryptEventForwarderConfigModel<SnowflakeEventForwarderStoredConfig>(
            eventForwarderConfig,
          );

        assertEventForwarderWriteAccessResult(
          await testEventForwarderWriteAccess(context, {
            sinkType: "snowflake",
            datasource,
            params: datasourceParams as SnowflakeConnectionParams,
            config: decrypted,
          }),
        );

        result = await postProvisionEventForwarderToLicenseServer({
          organizationId: context.org.id,
          datasourceId: eventForwarderConfig.datasourceId,
          topic: eventForwarderConfig.topic,
          sinkType: "snowflake",
          snowflake: decrypted,
          attributeSchema,
          connectorName:
            eventForwarderConfig.connectorName?.trim() || undefined,
          connectorId: eventForwarderConfig.connectorId?.trim() || undefined,
        });
        break;
      }
      case "databricks": {
        const databricksConnectionParams =
          datasourceParams as DatabricksConnectionParams;
        const decrypted =
          decryptEventForwarderConfigModel<DatabricksEventForwarderStoredConfig>(
            eventForwarderConfig,
          );

        assertEventForwarderWriteAccessResult(
          await testEventForwarderWriteAccess(context, {
            sinkType: "databricks",
            datasource,
            params: databricksConnectionParams,
            config: decrypted,
          }),
        );

        await ensureEventForwarderDatabricksTables(
          databricksConnectionParams,
          decrypted,
        );

        // No Confluent resources; the license server just acks and the consumer picks the config up.
        result = await postProvisionEventForwarderToLicenseServer({
          sinkType: "databricks",
          organizationId: context.org.id,
          datasourceId: eventForwarderConfig.datasourceId,
          region: eventForwarderConfig.region ?? "us-east-1",
        });
        break;
      }
      default:
        throw new Error(
          `Unsupported event forwarder sink type for provisioning: ${String(eventForwarderConfig.sinkType)}`,
        );
    }

    // In-house consumer sinks have no connector to wait on: tables exist and
    // write access passed, so they are ready now.
    const inHouseConsumer = isInHouseConsumerSink(
      eventForwarderConfig.sinkType,
    );
    const currentEventForwarderConfig =
      await context.models.eventForwarderConfigs.update(eventForwarderConfig, {
        schemaId: result.schemaId,
        status: inHouseConsumer ? "ready" : "pending",
        connectorName: result.connectorName,
        connectorId: result.connectorId,
        lastProvisioningError: "",
      });
    if (inHouseConsumer) {
      await queueInitialWarehouseSyncIfNeeded(
        context,
        currentEventForwarderConfig,
      );
    }

    try {
      await reconcileEventForwarderDatasourceUserIdTypesAndExposureQueries(
        context,
        currentEventForwarderConfig,
        context.org.settings?.attributeSchema ?? [],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error(
        {
          datasourceId: eventForwarderConfig.datasourceId,
          organizationId: context.org.id,
          error: message,
        },
        "Failed to sync userIdTypes after event forwarder provisioning",
      );
    }

    try {
      await ensureEventForwarderFeatureUsageQuery(
        context,
        currentEventForwarderConfig,
        datasourceParams,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error(
        {
          datasourceId: eventForwarderConfig.datasourceId,
          organizationId: context.org.id,
          error: message,
        },
        "Failed to create feature usage query after event forwarder provisioning",
      );
    }

    try {
      await ensureEventForwarderEventsFactTable(
        context,
        currentEventForwarderConfig,
        datasourceParams,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error(
        {
          datasourceId: eventForwarderConfig.datasourceId,
          organizationId: context.org.id,
          error: message,
        },
        "Failed to create Events fact table after event forwarder provisioning",
      );
    }

    if (options?.restartAfterProvision && result.connectorName.trim()) {
      await postRestartEventForwarderToLicenseServer({
        organizationId: context.org.id,
        datasourceId: eventForwarderConfig.datasourceId,
        connectorName: result.connectorName,
      });
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown provisioning error";
    logger.error(
      {
        eventForwarderConfigId: eventForwarderConfig.id,
        organizationId: context.org.id,
        error: message,
      },
      "Failed to provision event forwarder config via license server",
    );

    await context.models.eventForwarderConfigs.update(eventForwarderConfig, {
      status: "error",
      lastProvisioningError: message,
    });

    throw new Error(message);
  }
}

/**
 * Pushes updated connection credentials to the Confluent connector for an
 * existing event forwarder. Called from `putDataSource` when the datasource
 * connection params change but no explicit `eventForwarderConfig` draft is
 * provided. Skips if no connector name is recorded (provisioning hasn't
 * completed).
 *
 * On success the config status is set to `ready`. On failure the error is
 * persisted as `status: "error"` and re-thrown so the HTTP response can
 * signal a partial failure.
 */
export async function updateEventForwarderCredentialsThroughLicenseServer(
  context: ReqContext,
  eventForwarderConfig: EventForwarderConfigInterface | null,
  datasourceParams?: EventForwarderDatasourceParams,
): Promise<void> {
  if (!eventForwarderConfig) {
    return;
  }

  const connectorName = eventForwarderConfig.connectorName?.trim();
  if (!connectorName) {
    return;
  }

  try {
    switch (eventForwarderConfig.sinkType) {
      case "bigquery": {
        const bigqueryConnectionParams = datasourceParams as
          | BigQueryConnectionParams
          | undefined;
        const decrypted =
          decryptEventForwarderConfigModel<BigQueryEventForwarderStoredConfig>(
            eventForwarderConfig,
          );
        const projectId = getBigQueryEventForwarderProjectId(
          decrypted,
          bigqueryConnectionParams,
        );

        if (!projectId) {
          throw new Error(
            "Missing BigQuery project id for event forwarder credential update",
          );
        }

        const tablePrefix =
          await resolveBigQueryEventForwarderTablePrefix(eventForwarderConfig);

        await postUpdateEventForwarderCredentialsToLicenseServer({
          organizationId: context.org.id,
          datasourceId: eventForwarderConfig.datasourceId,
          connectorName,
          sinkType: "bigquery",
          bigqueryProjectId: projectId,
          tablePrefix,
          bigqueryDataset: decrypted.dataset.trim(),
          serviceAccountKeyJson: (decrypted.serviceAccountKey ?? "").trim(),
        });
        break;
      }
      case "snowflake": {
        const decrypted =
          decryptEventForwarderConfigModel<SnowflakeEventForwarderStoredConfig>(
            eventForwarderConfig,
          );

        await postUpdateEventForwarderCredentialsToLicenseServer({
          organizationId: context.org.id,
          datasourceId: eventForwarderConfig.datasourceId,
          connectorName,
          sinkType: "snowflake",
          snowflake: decrypted,
        });
        break;
      }
      case "databricks":
        // Creds already re-encrypted into the config doc; the license server just acks.
        await postUpdateEventForwarderCredentialsToLicenseServer({
          organizationId: context.org.id,
          datasourceId: eventForwarderConfig.datasourceId,
          connectorName,
          sinkType: "databricks",
        });
        break;
      default:
        throw new Error(
          `Unsupported event forwarder sink type for credential update: ${String(eventForwarderConfig.sinkType)}`,
        );
    }

    await context.models.eventForwarderConfigs.update(eventForwarderConfig, {
      status: "ready",
      lastProvisioningError: "",
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown credential update error";
    logger.error(
      {
        eventForwarderConfigId: eventForwarderConfig.id,
        organizationId: context.org.id,
        error: message,
      },
      "Failed to update event forwarder connector credentials via license server",
    );

    await context.models.eventForwarderConfigs.update(eventForwarderConfig, {
      status: "error",
      lastProvisioningError: message,
    });

    throw new Error(message);
  }
}

/**
 * Pauses a provisioned event forwarder connector through the central license server.
 * Only ready configs can be paused; failed or pending configs do not have a
 * reliably running Confluent connector to pause.
 */
export async function pauseEventForwarderThroughLicenseServer(
  context: ReqContext,
  eventForwarderConfig: EventForwarderConfigInterface,
): Promise<void> {
  if (eventForwarderConfig.status !== "ready") {
    throw new Error("Only ready event forwarders can be paused");
  }

  const connectorName = eventForwarderConfig.connectorName?.trim();
  if (!connectorName) {
    throw new Error("Cannot pause event forwarder without a connector name");
  }

  try {
    await postPauseEventForwarderToLicenseServer({
      organizationId: context.org.id,
      datasourceId: eventForwarderConfig.datasourceId,
      connectorName,
    });

    await context.models.eventForwarderConfigs.update(eventForwarderConfig, {
      status: "paused",
      lastProvisioningError: "",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown pause error";
    logger.error(
      {
        eventForwarderConfigId: eventForwarderConfig.id,
        organizationId: context.org.id,
        error: message,
      },
      "Failed to pause event forwarder connector via license server",
    );

    await context.models.eventForwarderConfigs.update(eventForwarderConfig, {
      lastProvisioningError: message,
    });

    throw new Error(message);
  }
}

/**
 * Resumes a paused event forwarder connector through the central license server.
 */
export async function resumeEventForwarderThroughLicenseServer(
  context: ReqContext,
  eventForwarderConfig: EventForwarderConfigInterface,
): Promise<void> {
  if (eventForwarderConfig.status !== "paused") {
    throw new Error("Only paused event forwarders can be resumed");
  }

  const connectorName = eventForwarderConfig.connectorName?.trim();
  if (!connectorName) {
    throw new Error("Cannot resume event forwarder without a connector name");
  }

  try {
    await postResumeEventForwarderToLicenseServer({
      organizationId: context.org.id,
      datasourceId: eventForwarderConfig.datasourceId,
      connectorName,
    });

    await context.models.eventForwarderConfigs.update(eventForwarderConfig, {
      status: "ready",
      lastProvisioningError: "",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown resume error";
    logger.error(
      {
        eventForwarderConfigId: eventForwarderConfig.id,
        organizationId: context.org.id,
        error: message,
      },
      "Failed to resume event forwarder connector via license server",
    );

    await context.models.eventForwarderConfigs.update(eventForwarderConfig, {
      lastProvisioningError: message,
    });

    throw new Error(message);
  }
}

/**
 * Tears down Confluent resources via the license server (after Mongo cleanup).
 */
export async function teardownEventForwarderInfrastructureRemote(snapshot: {
  organizationId: string;
  datasourceId: string;
  sinkType?: EventForwarderSinkType;
  topic?: string;
  connectorName?: string;
  connectorId?: string;
}): Promise<void> {
  await postTeardownEventForwarderToLicenseServer({
    organizationId: snapshot.organizationId,
    datasourceId: snapshot.datasourceId,
    sinkType: snapshot.sinkType ?? "bigquery",
    topic: snapshot.topic,
    connectorName: snapshot.connectorName,
    connectorId: snapshot.connectorId,
  });
}
