import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { SDKAttributeSchema } from "shared/types/organization";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import {
  BigQueryEventForwarderStoredConfig,
  SnowflakeEventForwarderStoredConfig,
} from "shared/types/event-forwarder";
import { EventForwarderConfigInterface } from "shared/validators";
import {
  postProvisionEventForwarderToLicenseServer,
  postTeardownEventForwarderToLicenseServer,
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
