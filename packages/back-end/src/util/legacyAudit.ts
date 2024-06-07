import { AuditInterface } from "../../types/audit";
import { AuditNotificationEvent } from "../events/notification-events";
import { createEvent } from "../models/EventModel";
import { toAuditEventMappings } from "../events/base-types";

export async function insertAudit(
  data: Omit<AuditInterface, "id">
): Promise<AuditInterface> {
  const {
    reason,
    parent,
    details,
    organization: organizationId,
    event,
    ...payload
  } = data;
  const auditData = { reason, parent, details };

  const savedObject = await createEvent(organizationId, {
    ...toAuditEventMappings[event],
    ...payload,
    auditData,
  } as AuditNotificationEvent);

  if (!savedObject) throw new Error("Error while saving audit!");

  return {
    ...data,
    id: savedObject.id,
  } as AuditInterface;
}
