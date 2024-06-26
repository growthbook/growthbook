import {
  AuditUserLoggedIn,
  AuditUserApiKey,
  AuditInterface,
} from "../../types/audit";
import { createEvent } from "../models/EventModel";
import { EventAuditUser } from "../events/event-types";
import { toAuditEventMappings } from "./legacyAuditBase";

const wrapUser = (
  user: AuditUserLoggedIn | AuditUserApiKey
): EventAuditUser => {
  if ("name" in user) return { type: "dashboard", ...user };

  return { type: "api_key", ...user };
};

export async function insertAudit(
  data: Omit<AuditInterface, "id">
): Promise<AuditInterface> {
  const {
    reason,
    parent,
    details,
    organization: organizationId,
    event,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    entity,
    user,
    ...payload
  } = data;

  const savedObject = await createEvent(organizationId, {
    ...toAuditEventMappings[event],
    ...payload,
    data: undefined,
    projects: [] as string[],
    tags: [] as string[],
    environments: [] as string[],
    containsSecrets: false,
    user: wrapUser(user),
    auditData: { reason, parent, details },
  });

  if (!savedObject) throw new Error("Error while saving audit!");

  return {
    ...data,
    id: savedObject.id,
  } as AuditInterface;
}
