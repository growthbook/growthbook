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
import { ReqContext } from "back-end/types/request";

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

  const updates: Partial<EventForwarderConfigInterface> = {};
  if (response.status === "ready") {
    updates.status = "ready";
    updates.lastProvisioningError = "";
  } else if (response.status === "error") {
    updates.status = "error";
    updates.lastProvisioningError =
      response.message || "Event forwarder connector failed";
  } else if (response.status === "paused") {
    updates.status = "paused";
    updates.lastProvisioningError = "";
  } else {
    updates.status = "pending";
  }

  if (
    updates.status !== eventForwarderConfig.status ||
    (updates.lastProvisioningError !== undefined &&
      updates.lastProvisioningError !==
        eventForwarderConfig.lastProvisioningError)
  ) {
    await context.models.eventForwarderConfigs.update(
      eventForwarderConfig,
      updates,
    );
  }

  return response;
}
