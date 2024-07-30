import { FilterQuery, QueryOptions } from "mongoose";
import {
  AuditUserLoggedIn,
  AuditUserApiKey,
  AuditInterface,
} from "../../../types/audit";
import {
  createEvent,
  EventModel,
  EventDocument,
} from "../../models/EventModel";
import { EventAuditUser } from "../../events/event-types";
import {
  AuditDocument,
  legacyFindAuditByEntityList,
} from "../../models/AuditModel";
import { ensureAndReturn } from "../types";
import { AuditNotificationEvent } from "../../events/notification-events";
import { AuditEventResource } from "./base";
import { auditEventMappings, eventAuditMappings } from "./maps";

const wrapUser = (
  user: AuditUserLoggedIn | AuditUserApiKey
): EventAuditUser => {
  if ("name" in user) return { type: "dashboard", ...user };

  return { type: "api_key", ...user };
};

const unwrapUser = (
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  { type, ...user }: NonNullable<EventAuditUser>
): AuditUserLoggedIn | AuditUserApiKey => user;

const legacyId = (id: string) => `legacyAudit-${id}`;
const isLegacyId = (id: string) => /^legacyAudit-/.test(id);
const fromLegacyId = (id: string) => id.replace(/^legacyAudit-/, "");
const fromLegacyIds = (ids: string[]) =>
  ids.filter(isLegacyId).map(fromLegacyId);

type ExpandedNotificationEventTemplate<T> = T extends AuditNotificationEvent
  ? EventDocument<T>
  : never;

type ExpandedNotificationEvent = ExpandedNotificationEventTemplate<AuditNotificationEvent>;

const toAuditInterface = ({
  id,
  organizationId: organization,
  dateCreated,
  data: {
    user,
    event,
    auditData: { id: objectId, parent, ...auditData },
  },
}: ExpandedNotificationEvent): AuditInterface => ({
  id: legacyId(id),
  organization,
  user: unwrapUser(ensureAndReturn(user)),
  ...eventAuditMappings({ id: objectId, parent: parent?.id })[event],
  dateCreated,
  ...auditData,
});

export async function insertAudit(
  data: Omit<AuditInterface, "id">
): Promise<AuditInterface> {
  const {
    reason,
    parent,
    details,
    organization: organizationId,
    event,
    entity: { id },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    entity,
    user,
    ...payload
  } = data;

  const savedObject = await createEvent(organizationId, {
    ...auditEventMappings({ id, reason, parent: parent?.id, details })[event],
    ...payload,
    data: undefined,
    projects: [] as string[],
    tags: [] as string[],
    environments: [] as string[],
    containsSecrets: false,
    user: wrapUser(user),
  });

  if (!savedObject) throw new Error("Error while saving audit!");

  return {
    ...data,
    id: legacyId(savedObject.id),
  } as AuditInterface;
}

export const findAuditByEntityList = async (
  organization: string,
  type: AuditEventResource,
  ids: string[],
  customFilter?: FilterQuery<AuditDocument>,
  options?: QueryOptions
): Promise<AuditInterface[]> => {
  const legacyDocs = await legacyFindAuditByEntityList(
    organization,
    type,
    ids,
    customFilter,
    options
  );

  const newIds = fromLegacyIds(ids);

  const newDocs = (
    await EventModel.find(
      {
        organization,
        "entity.auditData": { $not: null },
        "entity.object": type,
        "entity.id": {
          $in: newIds,
        },
        ...customFilter,
      },
      options
    )
  ).map((doc) =>
    toAuditInterface((doc as unknown) as ExpandedNotificationEvent)
  );

  return [...legacyDocs, ...newDocs];
};
