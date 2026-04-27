import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { BigQueryEventForwarderStoredConfig } from "shared/types/event-forwarder";
import { EventForwarderConfigInterface } from "shared/validators";
import {
  postProvisionEventForwarderToLicenseServer,
  postTeardownEventForwarderToLicenseServer,
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
  bigqueryConnectionParams?: BigQueryConnectionParams,
): Promise<void> {
  if (!eventForwarderConfig) {
    return;
  }

  if (eventForwarderConfig.sinkType !== "bigquery") {
    return;
  }

  const projectId =
    bigqueryConnectionParams?.defaultProject?.trim() ||
    bigqueryConnectionParams?.projectId?.trim() ||
    "";

  if (!projectId) {
    const message =
      "Missing BigQuery connector project id for event forwarder provisioning";
    await context.models.eventForwarderConfigs.update(eventForwarderConfig, {
      status: "error",
      lastProvisioningError: message,
    });
    throw new Error(message);
  }

  try {
    const resolvedTableName = await resolveBigQueryEventForwarderTableName(
      eventForwarderConfig,
      projectId,
    );

    const decrypted =
      decryptEventForwarderConfigModel<BigQueryEventForwarderStoredConfig>(
        eventForwarderConfig,
      );

    const result = await postProvisionEventForwarderToLicenseServer({
      organizationId: context.org.id,
      datasourceId: eventForwarderConfig.datasourceId,
      topic: eventForwarderConfig.topic,
      sinkType: "bigquery",
      bigqueryProjectId: projectId,
      resolvedTableName,
      bigqueryDataset: decrypted.dataset.trim(),
      serviceAccountKeyJson: (decrypted.serviceAccountKey ?? "").trim(),
      attributeSchema: context.org.settings?.attributeSchema ?? [],
      connectorName: eventForwarderConfig.connectorName?.trim() || undefined,
      connectorId: eventForwarderConfig.connectorId?.trim() || undefined,
    });

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
 * Tears down BigQuery Confluent resources via the license server (after Mongo cleanup).
 */
export async function teardownBigQueryEventForwarderInfrastructureRemote(snapshot: {
  organizationId: string;
  datasourceId: string;
  topic?: string;
  connectorName?: string;
  connectorId?: string;
}): Promise<void> {
  await postTeardownEventForwarderToLicenseServer({
    organizationId: snapshot.organizationId,
    datasourceId: snapshot.datasourceId,
    sinkType: "bigquery",
    topic: snapshot.topic,
    connectorName: snapshot.connectorName,
    connectorId: snapshot.connectorId,
  });
}
