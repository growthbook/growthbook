import mongoose from "mongoose";
import omit from "lodash/omit";
import { checkIfRevisionNeedsReview } from "shared/util";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  RevisionLog,
  RevisionChanges,
} from "shared/types/feature-revision";
import { EventUser, EventUserLoggedIn } from "shared/types/events/event-types";
import { OrganizationInterface } from "shared/types/organization";
import {
  MinimalFeatureRevisionInterface,
  ActiveDraftStatus,
  ACTIVE_DRAFT_STATUSES,
  RevisionMetadata,
} from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { applyEnvironmentInheritance } from "back-end/src/util/features";
import { logger } from "back-end/src/util/logger";
import { runValidateFeatureRevisionHooks } from "back-end/src/enterprise/sandbox/sandbox-eval";

export type ReviewSubmittedType = "Comment" | "Approved" | "Requested Changes";

const featureRevisionSchema = new mongoose.Schema({
  organization: String,
  featureId: String,
  createdBy: {},
  version: Number,
  baseVersion: Number,
  dateCreated: Date,
  dateUpdated: Date,
  datePublished: Date,
  publishedBy: {},
  comment: String,
  title: String,
  defaultValue: String,
  rules: {},
  // Revision envelopes — only present when explicitly changed
  environmentsEnabled: {},
  prerequisites: [{}],
  archived: Boolean,
  metadata: {},
  holdout: {},
  rampActions: [{}],
  // Users who have made edits to this draft beyond the original author.
  contributors: [{}],
  status: String,
  requiresReview: Boolean,
  log: [
    {
      _id: false,
      user: {},
      timestamp: Date,
      action: String,
      subject: String,
      value: String,
    },
  ],
});

featureRevisionSchema.index(
  { organization: 1, featureId: 1, version: 1 },
  { unique: true },
);
featureRevisionSchema.index({ organization: 1, status: 1 });

type FeatureRevisionDocument = mongoose.Document & FeatureRevisionInterface;

const FeatureRevisionModel = mongoose.model<FeatureRevisionInterface>(
  "FeatureRevision",
  featureRevisionSchema,
);

function toInterface(
  doc: FeatureRevisionDocument,
  context: ReqContext | ApiReqContext,
): FeatureRevisionInterface {
  const revision = omit(doc.toJSON<FeatureRevisionDocument>(), ["__v", "_id"]);

  // These fields are new, so backfill them for old revisions
  if (revision.publishedBy && !revision.publishedBy.type) {
    (revision.publishedBy as EventUserLoggedIn).type = "dashboard";
  }
  if (!revision.status) revision.status = "published";
  if (!revision.createdBy)
    revision.createdBy = revision.publishedBy || {
      type: "dashboard",
      email: "",
      id: "",
      name: "",
    };
  if (!revision.baseVersion) revision.baseVersion = revision.version - 1;
  if (!revision.dateUpdated) revision.dateUpdated = revision.dateCreated;
  if (!revision.datePublished) {
    revision.datePublished =
      (revision as FeatureRevisionInterface & { revisionDate?: Date })
        .revisionDate || revision.dateCreated;
  }

  revision.rules = applyEnvironmentInheritance(
    context.org.settings?.environments || [],
    revision.rules,
  );
  return revision;
}

export async function countDocuments(
  organization: string,
  {
    featureId,
    featureIds,
    status,
    author,
    involvedUserId,
  }: {
    featureId?: string;
    featureIds?: string[];
    status?: string | string[];
    author?: string;
    involvedUserId?: string;
  } = {},
): Promise<number> {
  const filter: Record<string, unknown> = { organization };
  if (featureId) filter.featureId = featureId;
  else if (featureIds) filter.featureId = { $in: featureIds };
  if (status) {
    filter.status = Array.isArray(status) ? { $in: status } : status;
  }
  if (author) filter["createdBy.id"] = author;
  if (involvedUserId) {
    filter.$or = [
      { "createdBy.id": involvedUserId },
      { "contributors.id": involvedUserId },
    ];
  }
  return FeatureRevisionModel.countDocuments(filter);
}

export async function getMinimalRevisions(
  context: ReqContext | ApiReqContext,
  organization: string,
  featureId: string,
): Promise<MinimalFeatureRevisionInterface[]> {
  const docs: FeatureRevisionDocument[] = await FeatureRevisionModel.find({
    organization,
    featureId,
  })
    .select(
      "version datePublished dateUpdated createdBy status comment title contributors",
    )
    .sort({ version: -1 })
    .limit(200);

  return docs.map((m) => ({
    version: m.version,
    datePublished: m.datePublished,
    dateUpdated: m.dateUpdated,
    createdBy: m.createdBy,
    status: m.status,
    comment: m.comment || "",
    ...(m.title ? { title: m.title } : {}),
    ...(m.contributors?.length ? { contributors: m.contributors } : {}),
  }));
}

export async function getFeaturePageRevisions(
  context: ReqContext | ApiReqContext,
  organization: string,
  featureId: string,
): Promise<FeatureRevisionInterface[]> {
  // Lean initial load: top-5 recent + all active drafts in parallel, then deduplicate.
  const [recentDocs, activeDraftDocs] = await Promise.all([
    // Top-5 most recent: covers the revision history UI without fetching everything.
    FeatureRevisionModel.find({ organization, featureId })
      .select("-log")
      .sort({ version: -1 })
      .limit(5),
    // All active drafts: a draft created from an old revision may fall outside the top-5 window.
    FeatureRevisionModel.find({
      organization,
      featureId,
      status: { $in: ACTIVE_DRAFT_STATUSES },
    }).select("-log"),
  ]);

  const seen = new Set<number>();
  const merged: FeatureRevisionDocument[] = [];
  for (const doc of [...recentDocs, ...activeDraftDocs]) {
    if (!seen.has(doc.version)) {
      seen.add(doc.version);
      merged.push(doc);
    }
  }

  // Base versions of active drafts: needed for autoMerge / conflict detection.
  // If the base falls outside the top-5 window, mergeResult would be null and publish CTAs break.
  const missingBaseVersions = activeDraftDocs
    .map((d) => d.baseVersion)
    .filter((v): v is number => typeof v === "number" && !seen.has(v));

  if (missingBaseVersions.length > 0) {
    const baseDocs = await FeatureRevisionModel.find({
      organization,
      featureId,
      version: { $in: missingBaseVersions },
    }).select("-log");
    for (const doc of baseDocs) {
      if (!seen.has(doc.version)) {
        seen.add(doc.version);
        merged.push(doc);
      }
    }
  }

  return merged.map((m) => toInterface(m, context));
}

export async function hasDraft(
  organization: string,
  feature: FeatureInterface,
  excludeVersions: number[] = [],
): Promise<boolean> {
  const doc = await FeatureRevisionModel.findOne({
    organization,
    featureId: feature.id,
    status: "draft",
    version: { $nin: excludeVersions },
  }).select("_id");

  return doc ? true : false;
}

/**
 * Returns the most recent active draft revision for a feature, or null if none exists.
 * Used to bundle new gated changes into an existing draft rather than creating a new one.
 */
export async function getActiveDraft(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
): Promise<FeatureRevisionInterface | null> {
  const doc = await FeatureRevisionModel.findOne({
    organization: feature.organization,
    featureId: feature.id,
    status: { $in: ACTIVE_DRAFT_STATUSES },
  })
    .select("-log")
    .sort({ version: -1 });

  return doc ? toInterface(doc, context) : null;
}

export async function getFeatureRevisionsByStatus({
  context,
  organization,
  featureId,
  featureIds,
  status,
  author,
  involvedUserId,
  limit = 10,
  offset = 0,
  sort = "desc",
  skipPagination = false,
}: {
  context: ReqContext;
  organization: string;
  featureId?: string;
  featureIds?: string[];
  status?: string | string[];
  author?: string;
  involvedUserId?: string;
  limit?: number;
  offset?: number;
  sort?: "asc" | "desc";
  skipPagination?: boolean;
}): Promise<FeatureRevisionInterface[]> {
  const filter: Record<string, unknown> = { organization };
  if (featureId) filter.featureId = featureId;
  else if (featureIds) filter.featureId = { $in: featureIds };
  if (status) {
    filter.status = Array.isArray(status) ? { $in: status } : status;
  }
  if (author) filter["createdBy.id"] = author;
  if (involvedUserId) {
    filter.$or = [
      { "createdBy.id": involvedUserId },
      { "contributors.id": involvedUserId },
    ];
  }
  let query = FeatureRevisionModel.find(filter)
    .select("-log") // Remove the log when fetching all revisions since it can be large to send over the network
    .sort({ version: sort === "desc" ? -1 : 1 });
  if (!skipPagination) {
    query = query.skip(offset).limit(limit);
  }
  const docs = await query;
  return docs.map((m) => toInterface(m, context));
}

// Returns the most recently updated active draft for a feature, or null.
export async function getLatestActiveDraftForFeature(
  context: ReqContext | ApiReqContext,
  organization: string,
  featureId: string,
  { involvedUserId }: { involvedUserId?: string } = {},
): Promise<FeatureRevisionInterface | null> {
  const filter: Record<string, unknown> = {
    organization,
    featureId,
    status: { $in: ACTIVE_DRAFT_STATUSES },
  };
  if (involvedUserId) {
    filter.$or = [
      { "createdBy.id": involvedUserId },
      { "contributors.id": involvedUserId },
    ];
  }
  const doc = await FeatureRevisionModel.findOne(filter, { log: 0 }).sort({
    dateUpdated: -1,
  });

  return doc ? toInterface(doc, context) : null;
}

export async function getRevision({
  context,
  organization,
  featureId,
  version,
  includeLog = false,
}: {
  context: ReqContext | ApiReqContext;
  organization: string;
  featureId: string;
  version: number;
  includeLog?: boolean;
}) {
  const doc = await FeatureRevisionModel.findOne({
    organization,
    featureId,
    version,
  }).select(includeLog ? undefined : "-log");

  return doc ? toInterface(doc, context) : null;
}

export async function getRevisionsByVersions({
  context,
  organization,
  featureId,
  versions,
}: {
  context: ReqContext | ApiReqContext;
  organization: string;
  featureId: string;
  versions: number[];
}) {
  const docs = await FeatureRevisionModel.find({
    organization,
    featureId,
    version: { $in: versions },
  }).select("-log");

  return docs.map((doc) => toInterface(doc, context));
}

// Fields excluded in sparse mode: large/unused payload for list-view callers.
const SPARSE_REVISION_PROJECTION = {
  log: 0,
  rules: 0,
  defaultValue: 0,
  environmentsEnabled: 0,
  prerequisites: 0,
  archived: 0,
  metadata: 0,
  baseVersion: 0,
  datePublished: 0,
  publishedBy: 0,
  requiresReview: 0,
};

export async function getRevisionsByStatus(
  context: ReqContext,
  statuses: string[],
  { sparse = false }: { sparse?: boolean } = {},
) {
  const projection = sparse ? SPARSE_REVISION_PROJECTION : { log: 0 };
  const revisions = await FeatureRevisionModel.find(
    { organization: context.org.id, status: { $in: statuses } },
    projection,
  );

  return revisions.filter((r) => !!r).map((r) => toInterface(r, context));
}

export async function createInitialRevision(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  user: EventUser | null,
  environments: string[],
  date?: Date,
) {
  const rules: Record<string, FeatureRule[]> = {};
  const environmentsEnabled: Record<string, boolean> = {};
  environments.forEach((env) => {
    rules[env] = feature.environmentSettings?.[env]?.rules || [];
    environmentsEnabled[env] =
      feature.environmentSettings?.[env]?.enabled ?? false;
  });

  date = date || new Date();

  const doc = await FeatureRevisionModel.create({
    organization: feature.organization,
    featureId: feature.id,
    version: 1,
    dateCreated: date,
    dateUpdated: date,
    datePublished: date,
    createdBy: user,
    baseVersion: 0,
    status: "published",
    publishedBy: user,
    comment: "",
    defaultValue: feature.defaultValue,
    rules,
    environmentsEnabled,
    prerequisites: feature.prerequisites || [],
    archived: feature.archived ?? false,
    metadata: {
      description: feature.description,
      owner: feature.owner,
      project: feature.project,
      tags: feature.tags,
      neverStale: feature.neverStale,
      customFields: feature.customFields,
      jsonSchema: feature.jsonSchema,
      valueType: feature.valueType,
    },
  });

  return toInterface(doc, context);
}

export async function createRevisionFromLegacyDraft(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
) {
  if (!feature.legacyDraft) return;
  const doc = await FeatureRevisionModel.create(feature.legacyDraft);
  return toInterface(doc, context);
}

async function getLastRevision(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
): Promise<FeatureRevisionInterface | null> {
  const lastRevision = (
    await FeatureRevisionModel.find({
      organization: context.org.id,
      featureId: feature.id,
    })
      .sort({ version: -1 })
      .limit(1)
  )[0];

  return lastRevision ? toInterface(lastRevision, context) : null;
}

export async function createRevision({
  context,
  feature,
  user,
  environments,
  baseVersion,
  changes,
  publish,
  comment,
  title,
  org,
  canBypassApprovalChecks,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  user: EventUser;
  environments: string[];
  baseVersion?: number;
  changes?: Partial<FeatureRevisionInterface>;
  publish?: boolean;
  comment?: string;
  title?: string;
  org: OrganizationInterface;
  canBypassApprovalChecks?: boolean;
}) {
  // Get max version number
  const lastRevision = await getLastRevision(context, feature);
  const newVersion = lastRevision ? lastRevision.version + 1 : 1;

  const defaultValue =
    changes && "defaultValue" in changes
      ? changes.defaultValue
      : feature.defaultValue;

  const rules: Record<string, FeatureRule[]> = {};
  environments.forEach((env) => {
    if (changes && changes.rules) {
      rules[env] = changes.rules[env] || [];
    } else {
      rules[env] = feature.environmentSettings?.[env]?.rules || [];
    }
  });

  // All fields are always written as a complete snapshot so revisions are
  // self-contained and HEAD can be set to any revision without base traversal.
  // Legacy documents missing these fields are handled defensively at read/apply time.
  const environmentsEnabled: Record<string, boolean> = Object.fromEntries(
    environments.map((env) => [
      env,
      changes?.environmentsEnabled?.[env] ??
        feature.environmentSettings?.[env]?.enabled ??
        false,
    ]),
  );
  const prerequisites = changes?.prerequisites ?? feature.prerequisites ?? [];
  const archived = changes?.archived ?? feature.archived ?? false;
  const featureMetadataSnapshot: RevisionMetadata = {
    description: feature.description,
    owner: feature.owner,
    project: feature.project,
    tags: feature.tags,
    neverStale: feature.neverStale,
    customFields: feature.customFields,
    jsonSchema: feature.jsonSchema,
    valueType: feature.valueType,
  };
  // Always store a complete snapshot. Partial changes (e.g. { neverStale: true })
  // are merged on top so other metadata fields aren't silently dropped.
  const metadata: RevisionMetadata = changes?.metadata
    ? { ...featureMetadataSnapshot, ...changes.metadata }
    : featureMetadataSnapshot;
  // holdout: explicit null in changes = remove; undefined/absent = carry forward from live
  const holdout =
    "holdout" in (changes ?? {})
      ? (changes!.holdout ?? null)
      : (feature.holdout ?? null);

  if (!baseVersion) baseVersion = lastRevision?.version;
  if (!baseVersion) {
    throw new Error("can not determine base version for new revision");
  }

  const baseRevision =
    lastRevision?.version === baseVersion
      ? lastRevision
      : await getRevision({
          context,
          organization: feature.organization,
          featureId: feature.id,
          version: baseVersion,
        });

  if (!baseRevision) {
    throw new Error("can not find a base revision");
  }
  const status = "draft";
  const revision = {
    organization: feature.organization,
    featureId: feature.id,
    version: newVersion,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    datePublished: null,
    createdBy: user,
    baseVersion: baseVersion || feature.version,
    status,
    publishedBy: null,
    comment: comment || "",
    ...(title ? { title } : {}),
    defaultValue,
    rules,
    environmentsEnabled,
    prerequisites,
    archived,
    metadata,
    holdout,
  } as FeatureRevisionInterface;
  const requiresReview = checkIfRevisionNeedsReview({
    feature,
    baseRevision,
    revision,
    allEnvironments: environments,
    settings: org.settings,
    requireApprovalsLicensed: context.hasPremiumFeature("require-approvals"),
  });
  if (publish && (!requiresReview || canBypassApprovalChecks)) {
    revision.status = "published";
    revision.publishedBy = user;
    revision.datePublished = new Date();
  } else if (publish && requiresReview) {
    revision.status = "pending-review";
  }

  await runValidateFeatureRevisionHooks({
    context,
    feature,
    revision,
    original: baseRevision,
  });

  const doc = await FeatureRevisionModel.create(revision);

  // Fire and forget - no route that creates the revision expects the log to be there immediately
  context.models.featureRevisionLogs
    .create({
      featureId: revision.featureId,
      version: revision.version,
      action: "new revision",
      subject: `based on revision #${baseVersion || feature.version}`,
      user,
      value: JSON.stringify({
        status: publish ? "published" : "draft",
        comment: comment || "",
        defaultValue,
        rules,
        environmentsEnabled,
        prerequisites,
        archived,
        metadata,
        holdout,
      }),
    })
    .catch((e) => {
      logger.error(e, "Error creating revisionlog");
    });

  return toInterface(doc, context);
}

export async function updateRevision(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  changes: RevisionChanges,
  log: Omit<RevisionLog, "timestamp">,
  resetReview: boolean,
) {
  let status = revision.status;

  const MUTABLE_FIELDS = [
    "defaultValue",
    "rules",
    "environmentsEnabled",
    "prerequisites",
    "archived",
    "metadata",
    "holdout",
    "rampActions",
  ] as const;

  const hasMutableChange = MUTABLE_FIELDS.some((f) => f in changes);

  if (hasMutableChange) {
    if (
      !(
        revision.status === "draft" ||
        revision.status === "pending-review" ||
        revision.status === "approved" ||
        revision.status === "changes-requested"
      )
    ) {
      throw new Error("Can only update draft revisions");
    }
    // Reset changes-requested back to pending-review whenever any content changes.
    if (revision.status === "changes-requested") {
      status = "pending-review";
    }
  }
  if (resetReview && revision.status === "approved") {
    status = "pending-review";
  }

  await runValidateFeatureRevisionHooks({
    context,
    feature,
    revision: {
      ...revision,
      ...changes,
      status,
    },
    original: revision,
  });

  // Track contributors atomically using $addToSet (deep equality dedup).
  // Using a separate operator from $set avoids the race condition where two
  // concurrent edits both read the same stale contributors array.
  const contributorUpdate =
    log.user != null ? { $addToSet: { contributors: log.user } } : {};

  const doc = await FeatureRevisionModel.findOneAndUpdate(
    {
      organization: revision.organization,
      featureId: revision.featureId,
      version: revision.version,
    },
    {
      $set: {
        ...changes,
        status,
        dateUpdated: new Date(),
      },
      ...contributorUpdate,
    },
    { new: true },
  );

  // Fire and forget - no route that updates the revision expects the log to be there immediately
  context.models.featureRevisionLogs
    .create({
      ...log,
      featureId: revision.featureId,
      version: revision.version,
    })
    .catch((e) => {
      logger.error(e, "Error creating revisionlog");
    });

  return doc ? toInterface(doc, context) : null;
}

export async function markRevisionAsPublished(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  user: EventUser,
  comment?: string,
) {
  const action = revision.status === "draft" ? "publish" : "re-publish";

  const revisionComment = revision.comment ? revision.comment : comment;

  const changes: Partial<FeatureRevisionInterface> = {
    status: "published",
    publishedBy: user,
    datePublished: new Date(),
    dateUpdated: new Date(),
    comment: revisionComment,
  };

  await runValidateFeatureRevisionHooks({
    context,
    feature,
    revision: {
      ...revision,
      ...changes,
    },
    original: revision,
  });

  await FeatureRevisionModel.updateOne(
    {
      organization: revision.organization,
      featureId: revision.featureId,
      version: revision.version,
    },
    {
      $set: changes,
    },
  );

  // Fire and forget - no route that marks the revision as published expects the log to be there immediately
  context.models.featureRevisionLogs
    .create({
      featureId: revision.featureId,
      version: revision.version,
      action,
      subject: "",
      user,
      value: JSON.stringify(comment ? { comment } : {}),
    })
    .catch((e) => {
      logger.error(e, "Error creating revisionlog");
    });

  await dispatchRevisionPublishedHook(context, revision);
}

export async function markRevisionAsReviewRequested(
  context: ReqContext | ApiReqContext,
  revision: FeatureRevisionInterface,
  user: EventUser,
  comment?: string,
) {
  const action = "Review Requested";

  await FeatureRevisionModel.updateOne(
    {
      organization: revision.organization,
      featureId: revision.featureId,
      version: revision.version,
    },
    {
      $set: {
        status: "pending-review",
        datePublished: null,
        dateUpdated: new Date(),
        comment: comment,
      },
    },
  );

  // Fire and forget - no route that marks the revision as Review Requested expects the log to be there immediately
  context.models.featureRevisionLogs
    .create({
      featureId: revision.featureId,
      version: revision.version,
      action,
      subject: "",
      user,
      value: JSON.stringify(comment ? { comment } : {}),
    })
    .catch((e) => {
      logger.error(e, "Error creating revisionlog");
    });
}

export async function submitReviewAndComments(
  context: ReqContext | ApiReqContext,
  revision: FeatureRevisionInterface,
  user: EventUser,
  reviewSubmittedType: ReviewSubmittedType,
  comment?: string,
) {
  const action = reviewSubmittedType;
  let status = "pending-review";
  switch (reviewSubmittedType) {
    case "Approved":
      status = "approved";
      break;
    case "Requested Changes":
      status = "changes-requested";
      break;
    default:
      // we dont want comments to override approved state
      status = revision.status;
  }

  await FeatureRevisionModel.updateOne(
    {
      organization: revision.organization,
      featureId: revision.featureId,
      version: revision.version,
    },
    {
      $set: {
        status,
        datePublished: null,
        dateUpdated: new Date(),
      },
    },
  );

  // Fire and forget - no route that submits the review and comments expects the log to be there immediately
  context.models.featureRevisionLogs
    .create({
      featureId: revision.featureId,
      version: revision.version,
      action,
      subject: "",
      user,
      value: JSON.stringify(comment ? { comment } : {}),
    })
    .catch((e) => {
      logger.error(e, "Error creating revisionlog");
    });
}

export async function discardRevision(
  context: ReqContext | ApiReqContext,
  revision: FeatureRevisionInterface,
  user: EventUser,
) {
  if (revision.status === "published" || revision.status === "discarded") {
    throw new Error(`Can not discard ${revision.status} revisions`);
  }

  await FeatureRevisionModel.updateOne(
    {
      organization: revision.organization,
      featureId: revision.featureId,
      version: revision.version,
    },
    {
      $set: { status: "discarded", dateUpdated: new Date() },
    },
  );

  // Fire and forget - no route that discards the revision expects the log to be there immediately
  context.models.featureRevisionLogs
    .create({
      featureId: revision.featureId,
      version: revision.version,
      action: "discard",
      subject: "",
      user,
      value: JSON.stringify({}),
    })
    .catch((e) => {
      logger.error(e, "Error creating revisionlog");
    });
}

export async function getFeatureRevisionsByFeatureIds(
  context: ReqContext | ApiReqContext,
  organization: string,
  featureIds: string[],
): Promise<Record<string, FeatureRevisionInterface[]>> {
  const revisionsByFeatureId: Record<string, FeatureRevisionInterface[]> = {};

  if (featureIds.length) {
    const revisions = await FeatureRevisionModel.find({
      organization,
      status: { $in: ACTIVE_DRAFT_STATUSES },
      featureId: { $in: featureIds },
    })
      .select("-log") // Remove the log when fetching all revisions since it can be large to send over the network
      .sort({ version: -1 })
      .limit(10);
    revisions.forEach((revision) => {
      const featureId = revision.featureId;
      revisionsByFeatureId[featureId] = revisionsByFeatureId[featureId] || [];
      revisionsByFeatureId[featureId].push(toInterface(revision, context));
    });
  }

  return revisionsByFeatureId;
}

// Higher number = higher priority. When a feature has multiple active
// revisions, surface the most actionable one.
const DRAFT_STATUS_PRIORITY: Record<ActiveDraftStatus, number> = {
  "changes-requested": 4,
  "pending-review": 3,
  approved: 2,
  draft: 1,
};

export async function getActiveDraftStates(
  orgId: string,
  featureIds?: string[],
): Promise<Record<string, { status: ActiveDraftStatus; version: number }>> {
  const q: Record<string, unknown> = {
    organization: orgId,
    status: { $in: ACTIVE_DRAFT_STATUSES },
  };
  if (featureIds && featureIds.length > 0) {
    q.featureId = { $in: featureIds };
  }
  const docs = await FeatureRevisionModel.find(q, {
    featureId: 1,
    status: 1,
    version: 1,
    _id: 0,
  });

  const result: Record<string, { status: ActiveDraftStatus; version: number }> =
    {};
  for (const doc of docs) {
    const fid = doc.featureId;
    const status = doc.status as ActiveDraftStatus;
    const existing = result[fid];
    if (
      !existing ||
      DRAFT_STATUS_PRIORITY[status] > DRAFT_STATUS_PRIORITY[existing.status]
    ) {
      result[fid] = { status, version: doc.version };
    }
  }
  return result;
}

export async function deleteAllRevisionsForFeature(
  organization: string,
  featureId: string,
) {
  await FeatureRevisionModel.deleteMany({
    organization,
    featureId,
  });
}

export async function cleanUpPreviousRevisions(
  organization: string,
  featureId: string,
  date: Date,
) {
  await FeatureRevisionModel.deleteMany({
    organization,
    featureId,
    dateCreated: {
      $lt: date,
    },
  });
}

export async function getFeatureRevisionsByFeaturesCurrentVersion(
  context: ReqContext | ApiReqContext,
  features: FeatureInterface[],
): Promise<FeatureRevisionInterface[] | null> {
  if (features.length === 0) return null;
  const docs = await FeatureRevisionModel.find({
    $or: features.map((f) => ({
      featureId: f.id,
      organization: f.organization,
      version: f.version,
    })),
  }).select("-log"); // Remove the log when fetching all revisions since it can be large to send over the network

  return docs.map((m) => toInterface(m, context));
}

// ---------------------------------------------------------------------------
// Ramp schedule hook registry
//
// Services that need to react to revision publish/discard events register
// their handlers here at startup. Using a registry pattern avoids circular
// module dependencies between FeatureRevisionModel and services/rampSchedule.
// ---------------------------------------------------------------------------

type RevisionHook = (
  context: ReqContext | ApiReqContext,
  revision: FeatureRevisionInterface,
) => Promise<void>;

let _onRevisionPublishedHook: RevisionHook | null = null;

export function registerRevisionPublishedHook(hook: RevisionHook): void {
  _onRevisionPublishedHook = hook;
}

export async function dispatchRevisionPublishedHook(
  context: ReqContext | ApiReqContext,
  revision: FeatureRevisionInterface,
): Promise<void> {
  if (!_onRevisionPublishedHook) return;
  try {
    await _onRevisionPublishedHook(context, revision);
  } catch (e) {
    logger.error(e, "Error in revision published ramp hook");
  }
}

// Mark a revision as pending-parent so it waits for its sibling approval revision.
// Used by the ramp service when creating multi-target approval-gated steps.
export async function markRevisionAsPendingParent(
  organization: string,
  featureId: string,
  version: number,
): Promise<void> {
  await FeatureRevisionModel.updateOne(
    { organization, featureId, version },
    { $set: { status: "pending-parent" } },
  );
}
