import mongoose, { QueryOptions } from "mongoose";
import { omit } from "lodash";
import uniqid from "uniqid";
import { AuditInterface } from "../../types/audit";
import { EntityType } from "../types/Audit";

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

export const AuditModel = mongoose.model<AuditInterface>("Audit", auditSchema);

/**
 * Convert the Mongo document to an AuditInterface, omitting Mongo default fields __v, _id
 * @param doc
 */
const toInterface = (doc: AuditDocument): AuditInterface => {
  return omit(doc.toJSON<AuditDocument>(), ["__v", "_id"]);
};

export async function insertAudit(data: Partial<AuditInterface>) {
  const auditDoc = await AuditModel.create({
    ...data,
    id: uniqid("aud_"),
  });
  return toInterface(auditDoc);
}

export async function findByOrganization(
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

export async function findByEntity(
  organization: string,
  type: EntityType,
  id: string,
  options?: QueryOptions
) {
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

export async function findByEntityParent(
  organization: string,
  type: EntityType,
  id: string,
  options?: QueryOptions
) {
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

export async function findAllByEntityType(
  organization: string,
  type: EntityType,
  options?: QueryOptions
) {
  const auditDocs = await AuditModel.find(
    {
      organization,
      "entity.object": type,
    },
    options
  );
  return auditDocs.map((doc) => toInterface(doc));
}

export async function findAllByEntityTypeParent(
  organization: string,
  type: EntityType,
  options?: QueryOptions
) {
  const auditDocs = await AuditModel.find(
    {
      organization,
      "parent.object": type,
    },
    options
  );
  return auditDocs.map((doc) => toInterface(doc));
}
