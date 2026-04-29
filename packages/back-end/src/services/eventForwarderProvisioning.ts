import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { SDKAttributeSchema } from "shared/types/organization";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import {
  BigQueryEventForwarderStoredConfig,
  SnowflakeEventForwarderStoredConfig,
} from "shared/types/event-forwarder";
import { EventForwarderConfigInterface } from "shared/validators";
import {
  postPauseEventForwarderToLicenseServer,
  postProvisionEventForwarderToLicenseServer,
  postResumeEventForwarderToLicenseServer,
  postTeardownEventForwarderToLicenseServer,
  postUpdateEventForwarderCredentialsToLicenseServer,
  postUpdateEventForwarderSchemaToLicenseServer,
} from "back-end/src/enterprise/licenseUtil";
import { decryptEventForwarderConfigModel } from "back-end/src/services/eventForwarderConfig";
import { resolveBigQueryEventForwarderTableName } from "back-end/src/services/eventForwarderBqTableResolution";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";

/**
 * Provisions Confluent resources for a BigQuery event forwarder via the central license server.
 * Updates the Mongo document on success or error; throws after persisting error state.
 */
export async function provisionEventForwarderThroughLicenseServer(
  context: ReqContext,
  eventForwarderConfig: EventForwarderConfigInterface | null,
  datasourceParams?: BigQueryConnectionParams | SnowflakeConnectionParams,
): Promise<void> {
  if (!eventForwarderConfig) {
    return;
  }

  if (eventForwarderConfig.sinkType === "databricks") {
    return;
  }

  try {
    const attributeSchema = context.org.settings?.attributeSchema ?? [];
    let result: {
      schemaId: number;
      connectorName: string;
      connectorId: string;
    };

    if (eventForwarderConfig.sinkType === "bigquery") {
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
        connectorName: eventForwarderConfig.connectorName?.trim() || undefined,
        connectorId: eventForwarderConfig.connectorId?.trim() || undefined,
      });
    } else if (eventForwarderConfig.sinkType === "snowflake") {
      const decrypted =
        decryptEventForwarderConfigModel<SnowflakeEventForwarderStoredConfig>(
          eventForwarderConfig,
        );

      result = await postProvisionEventForwarderToLicenseServer({
        organizationId: context.org.id,
        datasourceId: eventForwarderConfig.datasourceId,
        topic: eventForwarderConfig.topic,
        sinkType: "snowflake",
        snowflake: decrypted,
        attributeSchema,
        connectorName: eventForwarderConfig.connectorName?.trim() || undefined,
        connectorId: eventForwarderConfig.connectorId?.trim() || undefined,
      });
    } else {
      throw new Error(
        `Unsupported event forwarder sink type for provisioning: ${eventForwarderConfig.sinkType}`,
      );
    }

    await context.models.eventForwarderConfigs.update(eventForwarderConfig, {
      schemaId: result.schemaId,
      status: "ready",
      connectorName: result.connectorName,
      connectorId: result.connectorId,
      lastProvisioningError: "",
    });
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
 * completed) or if the sink type is `databricks`.
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

  if (eventForwarderConfig.sinkType === "databricks") {
    return;
  }

  const connectorName = eventForwarderConfig.connectorName?.trim();
  if (!connectorName) {
    return;
  }

  try {
    if (eventForwarderConfig.sinkType === "bigquery") {
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
    } else if (eventForwarderConfig.sinkType === "snowflake") {
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
    } else {
      throw new Error(
        `Unsupported event forwarder sink type for credential update: ${eventForwarderConfig.sinkType}`,
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

  if (eventForwarderConfig.sinkType === "databricks") {
    throw new Error("Databricks event forwarders cannot be paused");
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

  if (eventForwarderConfig.sinkType === "databricks") {
    throw new Error("Databricks event forwarders cannot be resumed");
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
 * Updates the Confluent Schema Registry schema for an event forwarder when the
 * org's attribute schema changes (e.g. a new attribute is added). Skips configs
 * that are not yet ready (no valid schemaId means provisioning hasn't completed).
 * Records a "schema_update_error" status on failure but does not throw, so the
 * caller's operation (attribute save) is never rolled back.
 */
export async function updateEventForwarderSchemaThroughLicenseServer(
  context: ReqContext,
  eventForwarderConfig: EventForwarderConfigInterface,
  attributeSchema: SDKAttributeSchema,
): Promise<void> {
  if (eventForwarderConfig.sinkType !== "bigquery") {
    return;
  }

  if (eventForwarderConfig.status !== "ready") {
    return;
  }

  try {
    const result = await postUpdateEventForwarderSchemaToLicenseServer({
      organizationId: context.org.id,
      datasourceId: eventForwarderConfig.datasourceId,
      topic: eventForwarderConfig.topic,
      sinkType: eventForwarderConfig.sinkType,
      schemaId: eventForwarderConfig.schemaId,
      attributeSchema,
      connectorName: eventForwarderConfig.connectorName,
      connectorId: eventForwarderConfig.connectorId,
    });

    await context.models.eventForwarderConfigs.update(eventForwarderConfig, {
      schemaId: result.schemaId,
      lastProvisioningError: "",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown schema update error";
    logger.error(
      {
        eventForwarderConfigId: eventForwarderConfig.id,
        organizationId: context.org.id,
        error: message,
      },
      "Failed to update event forwarder schema via license server",
    );
    await context.models.eventForwarderConfigs.update(eventForwarderConfig, {
      status: "schema_update_error",
      lastProvisioningError: message,
    });
  }
}

/**
 * Tears down BigQuery Confluent resources via the license server (after Mongo cleanup).
 */
export async function teardownBigQueryEventForwarderInfrastructureRemote(snapshot: {
  organizationId: string;
  datasourceId: string;
  sinkType?: "bigquery" | "snowflake" | "databricks";
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
