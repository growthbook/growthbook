import mongoose, { FilterQuery, QueryOptions } from "mongoose";
import { omit } from "lodash";
import uniqid from "uniqid";
import {
  AuditInterface,
  AuditUserLoggedIn,
  AuditUserApiKey,
  AuditUserSystem,
} from "back-end/types/audit";
import { EntityType, EventTypes } from "back-end/src/types/Audit";

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
  const json = doc.toJSON<AuditDocument>();

  // Use type assertion to handle the user field
  const user = json.user as any;

  const transformed = {
    id: json.id,
    organization: json.organization,
    user,
    event: json.event,
    entity: json.entity
      ? {
          object: json.entity.object,
          id: json.entity.id,
          name: json.entity.name,
        }
      : undefined,
    parent: json.parent
      ? {
          object: json.parent.object,
          id: json.parent.id,
        }
      : undefined,
    reason: json.reason,
    details: json.details,
    dateCreated: json.dateCreated,
  };
  return transformed as AuditInterface;
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

/**
 * find all audits by user id and organization
 * @param userId
 * @param organization
 * @param options
 */
export async function findAuditByUserIdAndOrganization(
  userId: string,
  organization: string,
  options?: QueryOptions
): Promise<AuditInterface[]> {
  // Then try to find any audit records for this user
  const userAudits = await AuditModel.find({
    "user.id": userId,
    organization,
    ...options,
  }).limit(100);
  const transformed = userAudits.map((doc) => toInterface(doc));
  return transformed;
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
  ).limit(100);
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
