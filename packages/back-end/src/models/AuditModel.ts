import mongoose, { FilterQuery, QueryOptions } from "mongoose";
import { omit } from "lodash";
import uniqid from "uniqid";
import { AuditInterface } from "back-end/types/audit";
import { EntityType } from "back-end/src/types/Audit";
import { ApiAuditLog } from "back-end/types/openapi";

const auditSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  organization: {
    type: String,
    index: true,
  },
  user: {
    _id: false,
    id: String,
    email: String,
    name: String,
    apiKey: String,
  },
  reason: String,
  event: String,
  entity: {
    _id: false,
    object: String,
    id: String,
    name: String,
  },
  parent: {
    _id: false,
    object: String,
    id: String,
  },
  details: String,
  dateCreated: Date,
});

type AuditDocument = mongoose.Document & AuditInterface;

const AuditModel = mongoose.model<AuditInterface>("Audit", auditSchema);

/**
 * Convert the Mongo document to an AuditInterface, omitting Mongo default fields __v, _id
 * @param doc
 */
const toInterface = (doc: AuditDocument): AuditInterface => {
  return (omit(doc.toJSON<AuditDocument>(), [
    "__v",
    "_id",
  ]) as unknown) as AuditInterface;
};

export async function insertAudit(
  data: Omit<AuditInterface, "id">
): Promise<AuditInterface> {
  const auditDoc = await AuditModel.create({
    ...data,
    id: uniqid("aud_"),
  });
  return toInterface(auditDoc);
}

export async function findAuditByOrganization(
  organization: string,
  options?: QueryOptions
): Promise<AuditInterface[]> {
  const auditDocs = await AuditModel.find(
    {
      organization,
    },
    options
  );
  return auditDocs.map((doc) => toInterface(doc));
}

export async function findAuditByEntity(
  organization: string,
  type: EntityType,
  id: string,
  options?: QueryOptions
): Promise<AuditInterface[]> {
  const auditDocs = await AuditModel.find(
    {
      organization,
      "entity.object": type,
      "entity.id": id,
    },
    options
  );
  return auditDocs.map((doc) => toInterface(doc));
}

export async function findAuditByEntityList(
  organization: string,
  type: EntityType,
  ids: string[],
  customFilter?: FilterQuery<AuditDocument>,
  options?: QueryOptions
): Promise<AuditInterface[]> {
  const auditDocs = await AuditModel.find(
    {
      organization,
      "entity.object": type,
      "entity.id": {
        $in: ids,
      },
      ...customFilter,
    },
    options
  );
  return auditDocs.map((doc) => toInterface(doc));
}

export async function findAuditByEntityParent(
  organization: string,
  type: EntityType,
  id: string,
  options?: QueryOptions
): Promise<AuditInterface[]> {
  const auditDocs = await AuditModel.find(
    {
      organization,
      "parent.object": type,
      "parent.id": id,
    },
    options
  );
  return auditDocs.map((doc) => toInterface(doc));
}

export async function findAuditAndChildrenByEntity(
  organization: string,
  type: EntityType,
  id: string,
  options?: QueryOptions
): Promise<AuditInterface[]> {
  const events = await Promise.all([
    findAuditByEntity(organization, type, id, options),
    findAuditByEntityParent(organization, type, id, options),
  ]);

  const merged = [...events[0], ...events[1]];

  merged.sort((a, b) => {
    if (b.dateCreated > a.dateCreated) return 1;
    else if (b.dateCreated < a.dateCreated) return -1;
    return 0;
  });
  return merged;
}

export async function findAllAuditsByEntityType(
  organization: string,
  type: EntityType,
  options?: QueryOptions
): Promise<AuditInterface[]> {
  const auditDocs = await AuditModel.find(
    {
      organization,
      "entity.object": type,
    },
    options
  );
  return auditDocs.map((doc) => toInterface(doc));
}

export async function findAllAuditsByEntityTypeParent(
  organization: string,
  type: EntityType,
  options?: QueryOptions
): Promise<AuditInterface[]> {
  const auditDocs = await AuditModel.find(
    {
      organization,
      "parent.object": type,
    },
    options
  );
  return auditDocs.map((doc) => toInterface(doc));
}

export async function findAllAuditsAndChildrenByEntityType(
  organization: string,
  type: EntityType,
  options?: QueryOptions
): Promise<AuditInterface[]> {
  const events = await Promise.all([
    findAllAuditsByEntityType(organization, type, options),
    findAllAuditsByEntityTypeParent(organization, type, options),
  ]);

  const merged = [...events[0], ...events[1]];

  merged.sort((a, b) => {
    if (b.dateCreated > a.dateCreated) return 1;
    else if (b.dateCreated < a.dateCreated) return -1;
    return 0;
  });

  return merged;
}

export function toApiAuditLog(audit: AuditInterface): ApiAuditLog {
  return {
    id: audit.id,
    event: audit.event,
    dateCreated: audit.dateCreated?.toISOString() || "",
    entity: audit.entity,
    user: audit.user,
    parent: audit.parent,
    reason: audit.reason,
    details: audit.details,
  };
}
