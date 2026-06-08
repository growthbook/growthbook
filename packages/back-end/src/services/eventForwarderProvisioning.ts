import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import {
  BigQueryEventForwarderStoredConfig,
  EventForwarderManagedResources,
  SnowflakeEventForwarderStoredConfig,
} from "shared/types/event-forwarder";
import { EventForwarderConfigInterface } from "shared/validators";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  postPauseEventForwarderToLicenseServer,
  postProvisionEventForwarderToLicenseServer,
  postRestartEventForwarderToLicenseServer,
  postResumeEventForwarderToLicenseServer,
  postTeardownEventForwarderToLicenseServer,
  postUpdateEventForwarderCredentialsToLicenseServer,
} from "back-end/src/enterprise/licenseUtil";
import { decryptEventForwarderConfigModel } from "back-end/src/services/eventForwarderConfig";
import { resolveBigQueryEventForwarderTableName } from "back-end/src/services/eventForwarderBqTableResolution";
import { testEventForwarderWriteAccess } from "back-end/src/services/eventForwarderWriteAccessValidation";
import { initializeDatasourceUserIdTypesFromOrgAttributeSchema } from "back-end/src/services/eventForwarderUserIdTypes";
import { ensureEventForwarderEventsFactTable } from "back-end/src/services/eventForwarderFactTable";
import { ensureEventForwarderBigQueryTables } from "back-end/src/services/eventForwarderBqTables";
import { ensureEventForwarderFeatureUsageQuery } from "back-end/src/services/eventForwarderFeatureUsageQueries";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";

function assertEventForwarderWriteAccessResult(
  result: Awaited<ReturnType<typeof testEventForwarderWriteAccess>>,
): void {
  const sinkWrite = result.results.sinkWrite;
  if (sinkWrite.result !== "success") {
    throw new Error(
      sinkWrite.resultMessage ||
        "Event Forwarder write access validation failed",
    );
  }
}

function mergeManagedResources(
  config: EventForwarderConfigInterface,
  updates: Partial<EventForwarderManagedResources>,
): EventForwarderManagedResources {
  return {
    identifierTypes:
      updates.identifierTypes ?? config.managedResources?.identifierTypes ?? [],
    exposureQueryIds:
      updates.exposureQueryIds ??
      config.managedResources?.exposureQueryIds ??
      [],
    featureUsageQueryIds:
      updates.featureUsageQueryIds ??
      config.managedResources?.featureUsageQueryIds ??
      [],
    ...(updates.factTableId !== undefined
      ? { factTableId: updates.factTableId }
      : config.managedResources?.factTableId !== undefined
        ? { factTableId: config.managedResources.factTableId }
        : {}),
  };
}

/**
 * Provisions Confluent resources for an event forwarder via the central license server.
 * Updates the Mongo document on success or error; throws after persisting error state.
 */
export async function provisionEventForwarderThroughLicenseServer(
  context: ReqContext,
  eventForwarderConfig: EventForwarderConfigInterface | null,
  datasourceParams?: BigQueryConnectionParams | SnowflakeConnectionParams,
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
        const projectId =
          bigqueryConnectionParams?.defaultProject?.trim() ||
          bigqueryConnectionParams?.projectId?.trim() ||
          "";

        if (!projectId) {
          throw new Error(
            "Missing BigQuery connector project id for event forwarder provisioning",
          );
        }

        const resolvedTableName =
          await resolveBigQueryEventForwarderTableName(eventForwarderConfig);

        const decrypted =
          decryptEventForwarderConfigModel<BigQueryEventForwarderStoredConfig>(
            eventForwarderConfig,
          );

        assertEventForwarderWriteAccessResult(
          await testEventForwarderWriteAccess(context, {
            sinkType: "bigquery",
            datasource,
            params: bigqueryConnectionParams as BigQueryConnectionParams,
            config: decrypted,
          }),
        );

        await ensureEventForwarderBigQueryTables({
          projectId,
          dataset: decrypted.dataset.trim(),
          tableName: resolvedTableName,
          serviceAccountKey: decrypted.serviceAccountKey,
        });

        result = await postProvisionEventForwarderToLicenseServer({
          organizationId: context.org.id,
          datasourceId: eventForwarderConfig.datasourceId,
          topic: eventForwarderConfig.topic,
          sinkType: "bigquery",
          bigqueryProjectId: projectId,
          resolvedTableName,
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
      default:
        throw new Error(
          `Unsupported event forwarder sink type for provisioning: ${String(eventForwarderConfig.sinkType)}`,
        );
    }

    let currentEventForwarderConfig =
      await context.models.eventForwarderConfigs.update(eventForwarderConfig, {
        schemaId: result.schemaId,
        status: "pending",
        connectorName: result.connectorName,
        connectorId: result.connectorId,
        lastProvisioningError: "",
      });

    try {
      const managedResources =
        await initializeDatasourceUserIdTypesFromOrgAttributeSchema(
          context,
          currentEventForwarderConfig.datasourceId,
          currentEventForwarderConfig,
        );
      if (managedResources) {
        currentEventForwarderConfig =
          await context.models.eventForwarderConfigs.update(
            currentEventForwarderConfig,
            {
              managedResources,
            },
          );
      }
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
      const featureUsageQueryIds = await ensureEventForwarderFeatureUsageQuery(
        context,
        currentEventForwarderConfig,
        datasourceParams,
      );
      if (featureUsageQueryIds.length > 0) {
        currentEventForwarderConfig =
          await context.models.eventForwarderConfigs.update(
            currentEventForwarderConfig,
            {
              managedResources: mergeManagedResources(
                currentEventForwarderConfig,
                {
                  featureUsageQueryIds,
                },
              ),
            },
          );
      }
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
      const factTableId = await ensureEventForwarderEventsFactTable(
        context,
        currentEventForwarderConfig,
        datasourceParams,
      );
      if (factTableId) {
        currentEventForwarderConfig =
          await context.models.eventForwarderConfigs.update(
            currentEventForwarderConfig,
            {
              managedResources: mergeManagedResources(
                currentEventForwarderConfig,
                {
                  factTableId,
                },
              ),
            },
          );
      }
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
  datasourceParams?: BigQueryConnectionParams | SnowflakeConnectionParams,
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
        const projectId =
          bigqueryConnectionParams?.defaultProject?.trim() ||
          bigqueryConnectionParams?.projectId?.trim() ||
          "";

        if (!projectId) {
          throw new Error(
            "Missing BigQuery project id for event forwarder credential update",
          );
        }

        const resolvedTableName =
          await resolveBigQueryEventForwarderTableName(eventForwarderConfig);

        const decrypted =
          decryptEventForwarderConfigModel<BigQueryEventForwarderStoredConfig>(
            eventForwarderConfig,
          );

        await postUpdateEventForwarderCredentialsToLicenseServer({
          organizationId: context.org.id,
          datasourceId: eventForwarderConfig.datasourceId,
          connectorName,
          sinkType: "bigquery",
          bigqueryProjectId: projectId,
          resolvedTableName,
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
  sinkType?: "bigquery" | "snowflake";
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
