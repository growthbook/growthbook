import mongoose, { FilterQuery, QueryOptions } from "mongoose";
import uniqid from "uniqid";
import { AuditInterface, EntityType } from "shared/types/audit";
import {
  removeMongooseFields,
  ToInterface,
} from "back-end/src/util/mongo.util";

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

const toInterface: ToInterface<AuditInterface> = (doc: AuditDocument) => {
  return removeMongooseFields(doc);
};

export async function insertAudit(
  data: Omit<AuditInterface, "id">,
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
 */
export async function findRecentAuditByUserIdAndOrganization(
  userId: string,
  organization: string,
): Promise<Omit<AuditInterface, "details">[]> {
  const userAudits = await AuditModel.find({
    "user.id": userId,
    organization,
  })
    .select("-details")
    .limit(10)
    .sort({ dateCreated: -1 });
  const transformed = userAudits.map((doc) => toInterface(doc));
  return transformed;
}

export async function findAuditByOrganization(
  organization: string,
  options?: QueryOptions,
): Promise<AuditInterface[]> {
  const auditDocs = await AuditModel.find(
    {
      organization,
    },
    options,
  );
  return auditDocs.map((doc) => toInterface(doc));
}

export async function findAuditByEntity(
  organization: string,
  type: EntityType,
  id: string,
  options?: QueryOptions,
  customFilter?: FilterQuery<AuditDocument>,
): Promise<AuditInterface[]> {
  const auditDocs = await AuditModel.find(
    {
      organization,
      "entity.object": type,
      "entity.id": id,
      ...customFilter,
    },
    null,
    options,
  );
  return auditDocs.map((doc) => toInterface(doc));
}

export async function findAuditByEntityList(
  organization: string,
  type: EntityType,
  ids: string[],
  customFilter?: FilterQuery<AuditDocument>,
  options?: QueryOptions,
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
    null,
    options,
  );
  return auditDocs.map((doc) => toInterface(doc));
}

export async function findAuditByEntityParent(
  organization: string,
  type: EntityType,
  id: string,
  options?: QueryOptions,
  customFilter?: FilterQuery<AuditDocument>,
): Promise<AuditInterface[]> {
  const auditDocs = await AuditModel.find(
    {
      organization,
      "parent.object": type,
      "parent.id": id,
      ...customFilter,
    },
    null,
    options,
  );
  return auditDocs.map((doc) => toInterface(doc));
}

export async function findAllAuditsByEntityType(
  organization: string,
  type: EntityType,
  options?: QueryOptions,
  customFilter?: FilterQuery<AuditDocument>,
): Promise<AuditInterface[]> {
  const auditDocs = await AuditModel.find(
    {
      organization,
      "entity.object": type,
      ...customFilter,
    },
    null,
    options,
  );
  return auditDocs.map((doc) => toInterface(doc));
}

export async function findAllAuditsByEntityTypeParent(
  organization: string,
  type: EntityType,
  options?: QueryOptions,
  customFilter?: FilterQuery<AuditDocument>,
): Promise<AuditInterface[]> {
  const auditDocs = await AuditModel.find(
    {
      organization,
      "parent.object": type,
      ...customFilter,
    },
    null,
    options,
  );
  return auditDocs.map((doc) => toInterface(doc));
}

export async function countAuditByEntity(
  organization: string,
  type: EntityType,
  id: string,
): Promise<number> {
  return await AuditModel.countDocuments({
    organization,
    "entity.object": type,
    "entity.id": id,
  });
}

export async function countAuditByEntityParent(
  organization: string,
  type: EntityType,
  id: string,
): Promise<number> {
  return await AuditModel.countDocuments({
    organization,
    "parent.object": type,
    "parent.id": id,
  });
}

export async function countAllAuditsByEntityType(
  organization: string,
  type: EntityType,
): Promise<number> {
  return await AuditModel.countDocuments({
    organization,
    "entity.object": type,
  });
}

export async function countAllAuditsByEntityTypeParent(
  organization: string,
  type: EntityType,
): Promise<number> {
  return await AuditModel.countDocuments({
    organization,
    "parent.object": type,
  });
}
