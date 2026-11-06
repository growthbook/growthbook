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
  cursor?: string;
  excludeIds?: string[];
};

// Where a page ended: the instant of its last event, and the events at that
// instant already returned. Excluding those (rather than everything at or after
// the instant) means events sharing a timestamp across a page boundary are
// neither skipped nor repeated, while the query still sorts by the index.
type AuditCursor = { before: Date; seenIds: string[] };

// Never part of an ISO date, so the first one splits date from ids.
const CURSOR_SEPARATOR = "_";

export function encodeAuditCursor({ before, seenIds }: AuditCursor): string {
  return `${before.toISOString()}${CURSOR_SEPARATOR}${seenIds.join(",")}`;
}

// A bare ISO date (cursors issued before ids were added) still means strictly before it.
export function parseAuditCursor(
  cursor: string | undefined,
): AuditCursor | undefined {
  if (!cursor) return undefined;
  const sep = cursor.indexOf(CURSOR_SEPARATOR);
  const before = new Date(sep === -1 ? cursor : cursor.slice(0, sep));
  if (isNaN(before.getTime())) {
    throw new Error("Invalid cursor");
  }
  const seenIds =
    sep === -1
      ? []
      : cursor
          .slice(sep + 1)
          .split(",")
          .filter(Boolean);
  return { before, seenIds };
}

// Events at the page's last instant, plus those the cursor already named
// when the whole page sat at that same instant.
function nextAuditCursor(
  events: AuditInterface[],
  current: AuditCursor | undefined,
): AuditCursor {
  const before = events[events.length - 1].dateCreated;
  const sameInstant = (d: Date) => d.getTime() === before.getTime();
  const carried = current && sameInstant(current.before) ? current.seenIds : [];
  const seenIds = events
    .filter((e) => sameInstant(e.dateCreated))
    .map((e) => e.id);
  return { before, seenIds: [...carried, ...seenIds] };
}

// Audits of one entity (or every entity of the type), matched as the entity itself or as its parent.
function historyQuery(
  organization: string,
  side: "entity" | "parent",
  type: EntityType,
  id: string | undefined,
  { auditId, event, cursor, excludeIds }: AuditHistoryFilters = {},
): FilterQuery<AuditDocument> {
  const idMatch = {
    ...(id ? { $eq: id } : {}),
    ...(excludeIds?.length ? { $nin: excludeIds } : {}),
  };
  const page = parseAuditCursor(cursor);
  const auditIdMatch = {
    ...(auditId ? { $eq: auditId } : {}),
    ...(page?.seenIds.length ? { $nin: page.seenIds } : {}),
  };
  return {
    organization,
    [`${side}.object`]: type,
    ...(Object.keys(idMatch).length ? { [`${side}.id`]: idMatch } : {}),
    ...(Object.keys(auditIdMatch).length ? { id: auditIdMatch } : {}),
    ...(event ? { event } : {}),
    ...(page
      ? {
          dateCreated: page.seenIds.length
            ? { $lte: page.before }
            : { $lt: page.before },
        }
      : {}),
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
  const countFilters = { ...filters, cursor: undefined };
  const query = (side: "entity" | "parent", f: AuditHistoryFilters) =>
    historyQuery(organization, side, type, id, f);
  // One past the page shows whether another page exists.
  const page = { limit: limit + 1, sort: { dateCreated: -1 as const } };

  const [entityCount, parentCount, entityDocs, parentDocs] = await Promise.all([
    AuditModel.countDocuments(query("entity", countFilters)),
    AuditModel.countDocuments(query("parent", countFilters)),
    AuditModel.find(query("entity", filters), null, page),
    AuditModel.find(query("parent", filters), null, page),
  ]);

  const candidates = [...entityDocs, ...parentDocs]
    .map((doc) => toInterface(doc))
    .sort((a, b) => b.dateCreated.getTime() - a.dateCreated.getTime());
  const events = candidates.slice(0, limit);

  return {
    events,
    total: entityCount + parentCount,
    nextCursor:
      candidates.length > limit
        ? encodeAuditCursor(
            nextAuditCursor(events, parseAuditCursor(filters.cursor)),
          )
        : null,
  };
}
