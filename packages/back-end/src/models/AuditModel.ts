import mongoose, { FilterQuery, QueryOptions } from "mongoose";
import { AuditInterface, EntityType } from "shared/types/audit";
import {
  removeMongooseFields,
  ToInterface,
} from "back-end/src/util/mongo.util";
import { generateId } from "back-end/src/util/uuid";

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
    oauthApp: {
      _id: false,
      id: String,
      name: String,
      delegated: Boolean,
    },
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

// History queries otherwise scan the org's entire audit log and sort in memory.
auditSchema.index({
  organization: 1,
  "entity.object": 1,
  "entity.id": 1,
  dateCreated: -1,
});
auditSchema.index({
  organization: 1,
  "parent.object": 1,
  "parent.id": 1,
  dateCreated: -1,
});
auditSchema.index({ organization: 1, "user.id": 1, dateCreated: -1 });
// Activity page filters by type alone, so the indexes above can't sort it.
auditSchema.index({ organization: 1, "entity.object": 1, dateCreated: -1 });
auditSchema.index({ organization: 1, "parent.object": 1, dateCreated: -1 });

type AuditDocument = mongoose.Document & AuditInterface;

const AuditModel = mongoose.model<AuditInterface>("Audit", auditSchema);

const toInterface: ToInterface<AuditInterface> = (doc) => {
  const audit = removeMongooseFields(doc);
  // Legacy audit docs may be missing the user field entirely
  if (!audit.user) {
    audit.user = { id: "", email: "", name: "Unknown" };
  }
  return audit;
};

export type AuditHistoryFilters = {
  auditId?: string;
  event?: string;
  before?: Date;
  excludeIds?: string[];
};

// Audits of one entity (or every entity of the type), matched as the entity itself or as its parent.
function historyQuery(
  organization: string,
  side: "entity" | "parent",
  type: EntityType,
  id: string | undefined,
  { auditId, event, before, excludeIds }: AuditHistoryFilters = {},
): FilterQuery<AuditDocument> {
  const idMatch = {
    ...(id ? { $eq: id } : {}),
    ...(excludeIds?.length ? { $nin: excludeIds } : {}),
  };
  return {
    organization,
    [`${side}.object`]: type,
    ...(Object.keys(idMatch).length ? { [`${side}.id`]: idMatch } : {}),
    ...(auditId ? { id: auditId } : {}),
    ...(event ? { event } : {}),
    ...(before ? { dateCreated: { $lt: before } } : {}),
  };
}

export async function insertAudit(
  data: Omit<AuditInterface, "id">,
): Promise<AuditInterface> {
  const auditDoc = await AuditModel.create({
    ...data,
    id: generateId("aud_"),
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
  filters?: AuditHistoryFilters,
): Promise<AuditInterface[]> {
  const auditDocs = await AuditModel.find(
    historyQuery(organization, "entity", type, id, filters),
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

export async function countAuditByEntity(
  organization: string,
  type: EntityType,
  id: string,
  filters?: AuditHistoryFilters,
): Promise<number> {
  return await AuditModel.countDocuments(
    historyQuery(organization, "entity", type, id, filters),
  );
}

// A page of audits newest first, with the total that matches the filters on any page.
export async function getAuditHistory(
  organization: string,
  type: EntityType,
  id: string | undefined,
  limit: number,
  filters: AuditHistoryFilters = {},
) {
  const countFilters = { ...filters, before: undefined };
  const query = (side: "entity" | "parent", f: AuditHistoryFilters) =>
    historyQuery(organization, side, type, id, f);
  const page = { limit, sort: { dateCreated: -1 as const } };

  const [entityCount, parentCount, entityDocs, parentDocs] = await Promise.all([
    AuditModel.countDocuments(query("entity", countFilters)),
    AuditModel.countDocuments(query("parent", countFilters)),
    AuditModel.find(query("entity", filters), null, page),
    AuditModel.find(query("parent", filters), null, page),
  ]);

  const events = [...entityDocs, ...parentDocs]
    .map((doc) => toInterface(doc))
    .sort((a, b) => b.dateCreated.getTime() - a.dateCreated.getTime())
    .slice(0, limit);

  return {
    events,
    total: entityCount + parentCount,
    nextCursor: events.length ? events[events.length - 1].dateCreated : null,
  };
}
