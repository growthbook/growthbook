import { EventForwarderStatus } from "shared/types/event-forwarder";
import {
  EventForwarderConnectorPhase,
  EventForwarderStatusResponse,
  EventForwarderConfigInterface,
} from "shared/validators";
import {
  EventForwarderLicenseConnectorPhase,
  EventForwarderLicenseConnectorStatus,
  postEventForwarderStatusToLicenseServer,
  postInitialEventForwarderSchematizationPingToLicenseServer,
} from "back-end/src/enterprise/licenseUtil";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";
import { queueEventForwarderWarehouseSync } from "back-end/src/jobs/pollEventForwarderWarehouseSync";

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

async function sendInitialSchematizationPingIfNeeded(
  context: ReqContext,
  eventForwarderConfig: EventForwarderConfigInterface,
): Promise<boolean> {
  if (eventForwarderConfig.initialGbUpdatePingSent) {
    return false;
  }

  const topic = eventForwarderConfig.topic?.trim();
  const schemaId = eventForwarderConfig.schemaId;
  if (!topic || schemaId <= 0) {
    return false;
  }

  try {
    await postInitialEventForwarderSchematizationPingToLicenseServer({
      organizationId: context.org.id,
      datasourceId: eventForwarderConfig.datasourceId,
      topic,
      schemaId,
    });
    await context.models.eventForwarderConfigs.update(eventForwarderConfig, {
      initialGbUpdatePingSent: true,
    });
    await queueEventForwarderWarehouseSync(
      context,
      eventForwarderConfig.datasourceId,
      { pingKind: "initial", schemaChanged: false },
    );
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
      "Failed to publish initial event forwarder schematization ping",
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

    await sendInitialSchematizationPingIfNeeded(context, eventForwarderConfig);
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
