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
} from "back-end/src/enterprise/licenseUtil";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";
import { queueDelayedEventForwarderWarehouseSyncForDatasource } from "back-end/src/services/eventForwarderWarehouseSync";

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
