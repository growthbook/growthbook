import mongoose, { FilterQuery, QueryOptions } from "mongoose";
import uniqid from "uniqid";
import { omit } from "lodash";
import { AuditInterface } from "back-end/types/audit";
import { EntityType } from "back-end/src/types/Audit";

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
  return omit(doc.toJSON<AuditDocument>(), [
    "__v",
    "_id",
  ]) as unknown as AuditInterface;
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
 * @param options
 */
export async function findAuditByUserIdAndOrganization(
  userId: string,
  organization: string,
  options?: QueryOptions,
): Promise<AuditInterface[]> {
  const userAudits = await AuditModel.find({
    "user.id": userId,
    organization,
    ...options,
  })
    .limit(100)
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
  let query = AuditModel.find({
    organization,
    "entity.object": type,
    "entity.id": id,
    ...customFilter,
  });

  if (options?.limit) query = query.limit(options.limit);
  if (options?.sort) query = query.sort(options.sort);

  const auditDocs = await query;
  return auditDocs.map((doc) => toInterface(doc));
}

export async function findAuditByEntityList(
  organization: string,
  type: EntityType,
  ids: string[],
  customFilter?: FilterQuery<AuditDocument>,
  options?: QueryOptions,
): Promise<AuditInterface[]> {
  let query = AuditModel.find({
    organization,
    "entity.object": type,
    "entity.id": {
      $in: ids,
    },
    ...customFilter,
  });

  if (options?.limit) query = query.limit(options.limit);
  if (options?.sort) query = query.sort(options.sort);

  const auditDocs = await query;
  return auditDocs.map((doc) => toInterface(doc));
}

export async function findAuditByEntityParent(
  organization: string,
  type: EntityType,
  id: string,
  options?: QueryOptions,
  customFilter?: FilterQuery<AuditDocument>,
): Promise<AuditInterface[]> {
  let query = AuditModel.find({
    organization,
    "parent.object": type,
    "parent.id": id,
    ...customFilter,
  });

  if (options?.limit) query = query.limit(options.limit);
  if (options?.sort) query = query.sort(options.sort);

  const auditDocs = await query;
  return auditDocs.map((doc) => toInterface(doc));
}

export async function findAllAuditsByEntityType(
  organization: string,
  type: EntityType,
  options?: QueryOptions,
  customFilter?: FilterQuery<AuditDocument>,
): Promise<AuditInterface[]> {
  let query = AuditModel.find({
    organization,
    "entity.object": type,
    ...customFilter,
  });

  if (options?.limit) query = query.limit(options.limit);
  if (options?.sort) query = query.sort(options.sort);

  const auditDocs = await query;
  return auditDocs.map((doc) => toInterface(doc));
}

export async function findAllAuditsByEntityTypeParent(
  organization: string,
  type: EntityType,
  options?: QueryOptions,
  customFilter?: FilterQuery<AuditDocument>,
): Promise<AuditInterface[]> {
  let query = AuditModel.find({
    organization,
    "parent.object": type,
    ...customFilter,
  });

  if (options?.limit) query = query.limit(options.limit);
  if (options?.sort) query = query.sort(options.sort);

  const auditDocs = await query;
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
