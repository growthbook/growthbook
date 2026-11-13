import mongoose, { FilterQuery, QueryOptions } from "mongoose";
import { omit } from "lodash";
import { AuditInterface, EntityType } from "shared/types/audit";
import {
  removeMongooseFields,
  ToInterface,
} from "back-end/src/util/mongo.util";
import { generateId } from "back-end/src/util/uuid";
import {
  DateCursor,
  dateCursorFilter,
  getNextDateCursor,
} from "back-end/src/util/dateCursor";

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
    requestedBy: {
      _id: false,
      id: String,
      name: String,
      email: String,
    },
    assumedRole: Boolean,
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
auditSchema.index(
  { organization: 1, "user.requestedBy.id": 1, dateCreated: -1 },
  { partialFilterExpression: { "user.requestedBy.id": { $exists: true } } },
);
// Activity page filters by type alone, so the indexes above can't sort it.
auditSchema.index({ organization: 1, "entity.object": 1, dateCreated: -1 });
auditSchema.index({ organization: 1, "parent.object": 1, dateCreated: -1 });

type AuditDocument = mongoose.Document & AuditInterface;

const AuditModel = mongoose.model<AuditInterface>("Audit", auditSchema);

// Revision audits keep who, what and when, never contents: a revision's
// snapshot and changes are read-gated by its entity, and audit history isn't.
const REVISION_AUDIT_FIELDS = [
  "id",
  "organization",
  "authorId",
  "version",
  "status",
  "revertedFrom",
  "reviewCycle",
  "resolution",
  "dateCreated",
  "dateUpdated",
];

export function revisionAuditDetails(doc: object): object {
  const source = doc as Record<string, unknown>;
  const details: Record<string, unknown> = {};
  REVISION_AUDIT_FIELDS.forEach((key) => {
    if (key in source) details[key] = source[key];
  });
  const target = source.target as { type?: string; id?: string } | undefined;
  if (target) details.target = { type: target.type, id: target.id };
  return details;
}

// An SDK connection's audit entry, without the keys that decrypt its payload
// and sign its proxy requests.
export function sdkConnectionAuditDetails(doc: object): object {
  const { proxy, ...rest } = omit(doc as { proxy?: object }, "encryptionKey");
  return proxy ? { ...rest, proxy: omit(proxy, "signingKey") } : rest;
}

// What each entity's audit entries may hold. Applied as entries are written
// and again as they're read, which covers the ones stored before it existed.
const AUDIT_DETAILS: Record<string, (doc: object) => object> = {
  revision: revisionAuditDetails,
  "sdk-connection": sdkConnectionAuditDetails,
};

export function scrubAuditDetails(entity: string, details: string): string {
  const project = AUDIT_DETAILS[entity];
  if (!project || !details) return details;
  try {
    const parsed = JSON.parse(details) as Record<string, unknown>;
    for (const side of ["pre", "post"]) {
      const doc = parsed[side];
      if (doc && typeof doc === "object") parsed[side] = project(doc);
    }
    return JSON.stringify(parsed);
  } catch {
    return "";
  }
}

const toInterface: ToInterface<AuditInterface> = (doc) => {
  const audit = removeMongooseFields(doc);
  // Legacy audit docs may be missing the user field entirely
  if (!audit.user) {
    audit.user = { id: "", email: "", name: "Unknown" };
  }
  if (audit.entity?.object && audit.details) {
    audit.details = scrubAuditDetails(audit.entity.object, audit.details);
  }
  return audit;
};

export type AuditHistoryFilters = {
  auditId?: string;
  event?: string;
  before?: DateCursor | null;
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
    ...(auditId ? { id: { $eq: auditId } } : {}),
    ...(event ? { event } : {}),
    ...dateCursorFilter(before),
  };
}

export async function insertAudit(
  data: Omit<AuditInterface, "id">,
  // A fixed id makes the insert idempotent: a repeat fails as a duplicate key.
  id: string = generateId("aud_"),
): Promise<AuditInterface> {
  const auditDoc = await AuditModel.create({
    ...data,
    id,
  });
  return toInterface(auditDoc);
}

// A member's recent actions, made directly or by a key that named them.
export async function findRecentAuditByUserIdAndOrganization(
  userId: string,
  organization: string,
): Promise<Omit<AuditInterface, "details">[]> {
  // `organization` in each branch, so each can use its own index.
  const userAudits = await AuditModel.find({
    $or: [
      { organization, "user.id": userId },
      { organization, "user.requestedBy.id": userId, "user.assumedRole": true },
    ],
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

// Which audited keys were personal access tokens and which org keys. Their
// audits record a token's owner as `userId`, null for an org key; older audits
// record neither, so those keys are in `all` only.
export async function getAuditedApiKeyKinds(organization: string) {
  const ids = async (details?: string): Promise<string[]> =>
    AuditModel.distinct("entity.id", {
      organization,
      "entity.object": "apiKey",
      ...(details && { details: { $regex: details } }),
    });
  const [all, tokens, orgKeys] = await Promise.all([
    ids(),
    ids('"userId":"'),
    ids('"userId":null'),
  ]);
  return { all, tokens: new Set(tokens), orgKeys: new Set(orgKeys) };
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
    nextCursor: getNextDateCursor(events, limit, filters.before),
  };
}
