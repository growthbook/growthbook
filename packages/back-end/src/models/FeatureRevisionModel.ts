import mongoose from "mongoose";
import uniqid from "uniqid";
import omit from "lodash/omit";
import {
  checkIfRevisionNeedsReview,
  isRevisionEditLockedBySchedule,
} from "shared/util";
import {
  FeatureInterface,
  FeatureRule,
  V1FeatureRule,
  V1FeatureRevisionInterface,
} from "shared/types/feature";
import {
  FeatureRevisionInterface,
  RevisionLog,
  RevisionChanges,
} from "shared/types/feature-revision";
import { EventUser, EventUserLoggedIn } from "shared/types/events/event-types";
import { Environment, OrganizationInterface } from "shared/types/organization";
import {
  MinimalFeatureRevisionInterface,
  ActiveDraftStatus,
  ACTIVE_DRAFT_STATUSES,
  RevisionMetadata,
  RevisionReview,
  reviewerKeyForEventUser,
} from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import {
  ensureUniqueRuleIds,
  flattenV1ToV2Rules,
  getApplicableEnvIds,
  isPlausibleFeatureRule,
  isV2RevisionRules,
  narrowRuleToApplicableEnvs,
  V1RulesByEnv,
} from "back-end/src/util/flattenRules";
import { upgradeFeatureRule } from "back-end/src/util/migrations";
import {
  applyEnvironmentInheritance,
  buildInheritedChildrenByAncestor,
  expandRuleEnvsForInheritance,
} from "back-end/src/util/features";
import { getEnvironments } from "back-end/src/util/organization.util";
import { logger } from "back-end/src/util/logger";
import { syncFeatureExperimentLinkages } from "back-end/src/util/featureExperimentSync";
import { syncFeatureContextualBanditLinkages } from "back-end/src/util/featureContextualBanditSync";
import { createWithVersionRetry } from "back-end/src/util/mongo.util";
import { runValidateFeatureRevisionHooks } from "back-end/src/enterprise/sandbox/sandbox-eval";
import {
  migrateRampScheduleEndCondition,
  migrateRampStepTriggers,
} from "./RampScheduleModel";

export type ReviewSubmittedType = "Comment" | "Approved" | "Requested Changes";

// Read-time migration: old docs stored contributors as EventUser objects;
// new docs store plain user-ID strings. Normalize to string[] so callers
// always see the current schema.
function migrateContributors(raw: unknown[] | undefined): string[] | undefined {
  if (!raw?.length) return raw as undefined;

  const ids = new Set<string>();
  for (const entry of raw) {
    if (entry == null) continue;
    if (typeof entry === "string") {
      if (entry) ids.add(entry);
    } else if (typeof entry === "object" && "id" in entry) {
      const id = (entry as { id?: string }).id;
      if (id) ids.add(id);
    }
  }
  return ids.size > 0 ? [...ids] : undefined;
}

const featureRevisionSchema = new mongoose.Schema({
  // Minted (`frev_<uniqid>`) and stored at creation for new docs. Legacy docs
  // instead expose a computed tuple form (`frev_<version>_<featureId>`, see
  // featureRevisionId), persisted opportunistically on publish writes —
  // deterministic, so their identity never changes as it materializes. The
  // two shapes cannot collide (uniqid suffixes contain no underscores).
  id: String,
  organization: String,
  featureId: String,
  createdBy: {},
  version: Number,
  baseVersion: Number,
  // Live feature version captured when this revision was approved; used to
  // detect approvals that have gone stale due to subsequent publishes.
  approvedBaseVersion: Number,
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
  // Active reviewer verdicts for the current review cycle. Maintained by the
  // review lifecycle mutations; cleared when a new review cycle starts.
  reviews: [
    {
      _id: false,
      userId: String,
      user: {},
      status: String,
      timestamp: Date,
    },
  ],
  status: String,
  requiresReview: Boolean,
  autoPublishOnApproval: Boolean,
  autoPublishEnabledBy: String,
  scheduledPublishAt: Date,
  scheduledPublishLockEdits: Boolean,
  scheduledPublishLockOthers: Boolean,
  scheduledPublishBypassApproval: Boolean,
  scheduledPublishAttempts: Number,
  scheduledPublishLastError: String,
  scheduledPublishNextAttemptAt: Date,
  scheduledPublishGaveUpAt: Date,
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

// Named so we can recognize its duplicate-key errors and translate them.
const PUBLISH_LOCK_OTHERS_INDEX = "uniqueArmedPublishLockOthers";

featureRevisionSchema.index(
  { organization: 1, featureId: 1, version: 1 },
  { unique: true },
);
// Non-unique + partial (id-bearing docs only): a lookup-speed index for the
// by-id resolver. Nothing relies on the DB enforcing id-uniqueness — minted
// ids come from uniqid and the real identity guarantee is the (organization,
// featureId, version) triplet above. A unique index would risk a build-time
// collision on legacy `id: null` docs and is heavier to build, for a guard
// uniqid makes moot. Legacy docs (no stored id) resolve via the tuple decode.
featureRevisionSchema.index(
  { organization: 1, id: 1 },
  { partialFilterExpression: { id: { $exists: true } } },
);
featureRevisionSchema.index({ organization: 1, status: 1 });
// Sparse: only scheduled revisions carry scheduledPublishAt, so the cross-org
// due-poller scans a tiny set.
featureRevisionSchema.index({ scheduledPublishAt: 1 }, { sparse: true });
// At most one armed "lock other drafts" schedule per feature — the atomic
// backstop for assertNoConflictingPublishLock against concurrent arming. Partial
// so canceling/publishing (which unsets the fields) drops the doc automatically.
featureRevisionSchema.index(
  { organization: 1, featureId: 1 },
  {
    name: PUBLISH_LOCK_OTHERS_INDEX,
    unique: true,
    partialFilterExpression: {
      autoPublishOnApproval: true,
      scheduledPublishLockOthers: true,
    },
  },
);

type FeatureRevisionDocument = mongoose.Document & FeatureRevisionInterface;

// Mint a fresh id for new docs at creation (bulk writes like insertMany skip
// save middleware — those docs are legacy-shaped and the computed tuple id
// covers them).
featureRevisionSchema.pre("save", function () {
  if (!this.id) this.id = uniqid("frev_");
});

const FeatureRevisionModel = mongoose.model<FeatureRevisionInterface>(
  "FeatureRevision",
  featureRevisionSchema,
);

// Project + env-settings the revision interface needs from the parent feature
// to apply env applicability filtering and rule-env inheritance expansion.
export type RevisionFeatureContext = Pick<
  FeatureInterface,
  "project" | "environmentSettings"
>;

/**
 * Pure JIT migration from a raw revision doc to a v2 `FeatureRevisionInterface`.
 * v1 `Record<env, FeatureRule[]>` is flattened via `flattenV1ToV2Rules`;
 * already-v2 arrays are filtered against the same `applicableEnvs` and
 * expanded for env inheritance so a rule scoped to a parent env also surfaces
 * in inheriting children.
 *
 * Callers should pass the parent `feature` (project + environmentSettings).
 * `undefined` is allowed for legacy paths but disables both the project
 * applicability filter and the inheritance expansion.
 */
export function buildFeatureRevisionInterface(
  raw: FeatureRevisionInterface,
  context: ReqContext | ApiReqContext,
  feature?: RevisionFeatureContext,
): FeatureRevisionInterface {
  const revision = { ...raw };

  // Computed identity — a pure projection of the immutable natural key, so
  // every revision has it regardless of what's on disk.
  if (!revision.id) {
    revision.id = featureRevisionId(revision.featureId, revision.version);
  }

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

  const orgEnvs = getEnvironments(context.org);
  const applicableEnvs = getApplicableEnvIds(orgEnvs, feature?.project);
  const applicableSet = new Set(applicableEnvs);
  // Mirrors `migrateRawFeatureToV2`'s v2 inheritance gating: a child env with
  // an explicit `environmentSettings` entry is treated as customized and does
  // NOT inherit rules from its ancestor.
  const childrenByAncestor = buildInheritedChildrenByAncestor(
    orgEnvs,
    feature?.environmentSettings || {},
  );
  const rawRules = revision.rules as unknown;

  if (isV2RevisionRules(rawRules)) {
    // v2 pass-through. `upgradeFeatureRule` heals pre-coverage experiment
    // rules; inheritance expansion adds any parent->child env propagation
    // missed at write time; `narrowRuleToApplicableEnvs` strips
    // non-applicable envs and collapses fully-orphaned rules to the no-env
    // pending state instead of dropping them. The `isPlausibleFeatureRule`
    // filter drops sparse `null`/`undefined` array entries so a single
    // corrupt slot can't abort the entire migration.
    revision.rules = rawRules
      .filter(isPlausibleFeatureRule)
      .map((r) => upgradeFeatureRule(r))
      .map((r) => expandRuleEnvsForInheritance(r, childrenByAncestor))
      .map((r) => narrowRuleToApplicableEnvs(r, applicableSet));
  } else {
    // v1 legacy `Record<env, FeatureRule[]>`. Inheritance must run BEFORE
    // flattening so a sparse child env still surfaces its parent's rules
    // (mirrors `migrateRawFeatureToV2`'s v1 path).
    const v1Record =
      (rawRules as V1FeatureRevisionInterface["rules"] | undefined) || {};
    const inheritedRecord = applyEnvironmentInheritance(orgEnvs, v1Record);
    const upgraded: V1RulesByEnv = {};
    for (const [envId, envRules] of Object.entries(inheritedRecord)) {
      upgraded[envId] = (envRules || [])
        .filter(isPlausibleFeatureRule)
        .map((r) => upgradeFeatureRule(r as FeatureRule) as V1FeatureRule);
    }
    revision.rules = flattenV1ToV2Rules(upgraded, {
      envOrder: orgEnvs.map((e) => e.id),
      applicableEnvs,
    });
  }

  // JIT migration: normalize legacy ramp action shapes on read:
  //   - endCondition → cutoffDate
  //   - steps[].trigger discriminated union → steps[].interval + holdConditions
  // Old DB documents may still hold these legacy shapes even though the schema
  // no longer defines them — cast through `unknown` so the migration can read.
  if (revision.rampActions?.length) {
    revision.rampActions = revision.rampActions.map((action) => {
      if (action.mode !== "create") return action;
      const endCondMigrated = migrateRampScheduleEndCondition(
        action as unknown as Parameters<
          typeof migrateRampScheduleEndCondition
        >[0],
      );
      const triggersMigrated = migrateRampStepTriggers(
        endCondMigrated as unknown as Parameters<
          typeof migrateRampStepTriggers
        >[0],
      );
      return triggersMigrated as unknown as typeof action;
    });
  }

  revision.contributors = migrateContributors(
    revision.contributors as unknown as unknown[],
  );

  return revision;
}

/**
 * The LEGACY-doc revision id: a deterministic projection of the immutable
 * natural key (version-first so parsing is unambiguous even though feature
 * ids may contain underscores). Remains valid forever for old docs and
 * resolves by decoding back onto the (organization, featureId, version) index.
 */
export function featureRevisionId(featureId: string, version: number): string {
  return `frev_${version}_${featureId}`;
}

/**
 * Decode a tuple-shaped (legacy) feature revision id; null when the shape
 * doesn't match — including for minted `frev_<uniqid>` ids, whose suffixes
 * contain no underscores and therefore never parse as tuples. Resolve those
 * via findFeatureRevisionCoordinatesByRevisionId instead.
 */
export function parseFeatureRevisionId(
  id: string,
): { featureId: string; version: number } | null {
  const match = id.match(/^frev_(\d+)_(.+)$/);
  if (!match) return null;
  return { featureId: match[2], version: parseInt(match[1], 10) };
}

/** Resolve a stored (minted) revision id to its lookup coordinates. */
export async function findFeatureRevisionCoordinatesByRevisionId(
  organization: string,
  revisionId: string,
): Promise<{ featureId: string; version: number } | null> {
  const doc = await FeatureRevisionModel.findOne(
    { organization, id: revisionId },
    { featureId: 1, version: 1 },
  ).lean();
  return doc ? { featureId: doc.featureId, version: doc.version } : null;
}

// Mongoose wrapper over `buildFeatureRevisionInterface`.
function toInterface(
  doc: FeatureRevisionDocument,
  context: ReqContext | ApiReqContext,
  feature: RevisionFeatureContext | undefined,
): FeatureRevisionInterface {
  const revision = omit(doc.toJSON<FeatureRevisionDocument>(), ["__v", "_id"]);
  return buildFeatureRevisionInterface(revision, context, feature);
}

// Convenience for call sites that already have the parent feature in scope.
export function revisionToInterfaceWithFeature(
  doc: FeatureRevisionDocument,
  context: ReqContext | ApiReqContext,
  feature: RevisionFeatureContext,
): FeatureRevisionInterface {
  return toInterface(doc, context, feature);
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
      { contributors: involvedUserId },
      { "contributors.id": involvedUserId },
    ];
  }
  return FeatureRevisionModel.countDocuments(filter);
}

/** Returns only the revisions that syncFeatureExperimentLinkages/
 * syncFeatureContextualBanditLinkages need — open drafts, plus the single
 * latest published revision — pre-split so callers don't have to re-derive
 * the distinction themselves. A feature's older superseded published
 * revisions are irrelevant to linkage syncing and deliberately excluded. */
export async function getLinkageSyncRevisionSummaries(
  organization: string,
  featureId: string,
): Promise<{
  openDrafts: Pick<FeatureRevisionInterface, "version" | "rules">[];
  liveRevision: Pick<FeatureRevisionInterface, "version" | "rules"> | null;
}> {
  const [openDraftDocs, liveDoc] = await Promise.all([
    FeatureRevisionModel.find({
      organization,
      featureId,
      status: { $in: ACTIVE_DRAFT_STATUSES },
    }).select("version rules"),
    FeatureRevisionModel.findOne({
      organization,
      featureId,
      status: "published",
    })
      .sort({ version: -1 })
      .select("version rules"),
  ]);
  return {
    openDrafts: openDraftDocs.map((d) => ({
      version: d.version,
      rules: d.rules,
    })),
    liveRevision: liveDoc
      ? { version: liveDoc.version, rules: liveDoc.rules }
      : null,
  };
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
      "version datePublished dateUpdated createdBy status comment title contributors autoPublishOnApproval scheduledPublishAt scheduledPublishLockEdits scheduledPublishLockOthers scheduledPublishBypassApproval",
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
    ...(m.contributors?.length
      ? {
          contributors: migrateContributors(
            m.contributors as unknown as unknown[],
          ),
        }
      : {}),
    ...(m.autoPublishOnApproval
      ? { autoPublishOnApproval: m.autoPublishOnApproval }
      : {}),
    ...(m.scheduledPublishAt
      ? { scheduledPublishAt: m.scheduledPublishAt }
      : {}),
    ...(m.scheduledPublishLockEdits
      ? { scheduledPublishLockEdits: m.scheduledPublishLockEdits }
      : {}),
    ...(m.scheduledPublishLockOthers
      ? { scheduledPublishLockOthers: m.scheduledPublishLockOthers }
      : {}),
    ...(m.scheduledPublishBypassApproval
      ? { scheduledPublishBypassApproval: m.scheduledPublishBypassApproval }
      : {}),
  }));
}

export async function getFeaturePageRevisions(
  context: ReqContext | ApiReqContext,
  organization: string,
  featureId: string,
  feature: RevisionFeatureContext | undefined,
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

  return merged.map((m) => toInterface(m, context, feature));
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

  return doc ? toInterface(doc, context, feature) : null;
}

export async function getFeatureRevisionsByStatus({
  context,
  organization,
  featureId,
  featureIds,
  feature,
  featuresByFeatureId,
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
  // Parent feature when querying by `featureId`. Required when using
  // `featureId`; otherwise pass `featuresByFeatureId` for multi-feature
  // queries so each revision is filtered against its own feature.
  feature?: RevisionFeatureContext;
  featuresByFeatureId?: Record<string, RevisionFeatureContext | undefined>;
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
      { contributors: involvedUserId },
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
  return docs.map((m) => {
    const f = featuresByFeatureId ? featuresByFeatureId[m.featureId] : feature;
    return toInterface(m, context, f);
  });
}

// Returns the most recently updated active draft for a feature, or null.
export async function getLatestActiveDraftForFeature(
  context: ReqContext | ApiReqContext,
  organization: string,
  featureId: string,
  feature: RevisionFeatureContext | undefined,
  {
    involvedUserId,
    status,
    author,
  }: {
    involvedUserId?: string;
    status?: string | string[];
    author?: string;
  } = {},
): Promise<FeatureRevisionInterface | null> {
  const filter: Record<string, unknown> = {
    organization,
    featureId,
    status: status
      ? Array.isArray(status)
        ? { $in: status }
        : status
      : { $in: ACTIVE_DRAFT_STATUSES },
  };
  if (involvedUserId) {
    filter.$or = [
      { "createdBy.id": involvedUserId },
      { contributors: involvedUserId },
      { "contributors.id": involvedUserId },
    ];
  }
  if (author) {
    filter["createdBy.id"] = author;
  }
  const doc = await FeatureRevisionModel.findOne(filter, { log: 0 }).sort({
    dateUpdated: -1,
  });

  return doc ? toInterface(doc, context, feature) : null;
}

export async function getRevision({
  context,
  organization,
  featureId,
  feature,
  version,
  includeLog = false,
}: {
  context: ReqContext | ApiReqContext;
  organization: string;
  featureId: string;
  // Parent feature. Drives env applicability filtering and v2 inheritance
  // expansion so rules scoped to envs no longer in the feature's project
  // are scrubbed and rules on a parent env surface in inheriting children.
  feature: RevisionFeatureContext | undefined;
  version: number;
  includeLog?: boolean;
}) {
  const doc = await FeatureRevisionModel.findOne({
    organization,
    featureId,
    version,
  }).select(includeLog ? undefined : "-log");

  return doc ? toInterface(doc, context, feature) : null;
}

export async function getRevisionsByVersions({
  context,
  organization,
  featureId,
  feature,
  versions,
}: {
  context: ReqContext | ApiReqContext;
  organization: string;
  featureId: string;
  feature: RevisionFeatureContext | undefined;
  versions: number[];
}) {
  const docs = await FeatureRevisionModel.find({
    organization,
    featureId,
    version: { $in: versions },
  }).select("-log");

  return docs.map((doc) => toInterface(doc, context, feature));
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
  {
    sparse = false,
    featuresByFeatureId,
  }: {
    sparse?: boolean;
    featuresByFeatureId?: Record<string, RevisionFeatureContext | undefined>;
  } = {},
) {
  const projection = sparse ? SPARSE_REVISION_PROJECTION : { log: 0 };
  const revisions = await FeatureRevisionModel.find(
    { organization: context.org.id, status: { $in: statuses } },
    projection,
  );

  return revisions
    .filter((r) => !!r)
    .map((r) => toInterface(r, context, featuresByFeatureId?.[r.featureId]));
}

/**
 * Normalize a `rules` input to the canonical v2 `FeatureRule[]` shape. v2
 * arrays pass through; v1 records get env inheritance applied before
 * flattening so a legacy caller's sparse `{dev: [r1]}` writes a rule scoped
 * to dev and any envs that inherit from dev. `applicableEnvs` is seeded from
 * org envs + feature project so fully-covering rules collapse to
 * `allEnvironments: true`. Always runs `ensureUniqueRuleIds` on the way out
 * so a buggy v2 caller passing duplicate ids can't smuggle them onto disk.
 * Exported for unit testing.
 */
export function normalizeRulesInputToV2(
  rulesInput: unknown,
  opts: { orgEnvs: Environment[]; featureProject?: string },
): FeatureRule[] {
  if (rulesInput === undefined || rulesInput === null) return [];

  let flat: FeatureRule[];
  if (isV2RevisionRules(rulesInput)) {
    flat = rulesInput
      .filter(isPlausibleFeatureRule)
      .map((r) => upgradeFeatureRule(r));
  } else {
    const record = rulesInput as Record<string, FeatureRule[] | undefined>;
    const inheritedRecord = applyEnvironmentInheritance(opts.orgEnvs, record);
    const upgraded: V1RulesByEnv = {};
    for (const [envId, envRules] of Object.entries(inheritedRecord)) {
      upgraded[envId] = (envRules || [])
        .filter(isPlausibleFeatureRule)
        .map((r) => upgradeFeatureRule(r as FeatureRule) as V1FeatureRule);
    }
    const applicableEnvs = getApplicableEnvIds(
      opts.orgEnvs,
      opts.featureProject,
    );
    flat = flattenV1ToV2Rules(upgraded, {
      envOrder: opts.orgEnvs.map((e) => e.id),
      applicableEnvs,
    });
  }

  // Persistence-safe: dedupe ids so the v2 array pass-through can't persist
  // a colliding-id payload from a buggy upstream caller. `flattenV1ToV2Rules`
  // already produces unique ids on the v1 record path, so this is a no-op
  // there.
  const { rules: deduped, collisions } = ensureUniqueRuleIds(flat);
  if (collisions.length > 0) {
    logger.warn(
      { featureProject: opts.featureProject, collisions },
      "Duplicate rule ids auto-suffixed in normalizeRulesInputToV2",
    );
  }
  return deduped;
}

export async function createInitialRevision(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  user: EventUser | null,
  environments: string[],
  date?: Date,
) {
  const rules: FeatureRule[] = (feature.rules ?? [])
    .filter(isPlausibleFeatureRule)
    .map((r) => upgradeFeatureRule(r));
  const environmentsEnabled: Record<string, boolean> = {};
  environments.forEach((env) => {
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
      baseConfig: feature.baseConfig ?? null,
    },
  });

  return toInterface(doc, context, feature);
}

export async function createRevisionFromLegacyDraft(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
) {
  if (!feature.legacyDraft) return;
  const doc = await FeatureRevisionModel.create(feature.legacyDraft);
  return toInterface(doc, context, feature);
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

  return lastRevision ? toInterface(lastRevision, context, feature) : null;
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
  // Read once to (a) seed the baseVersion default, (b) compute the initial
  // version guess used for validation hooks, and (c) prime the first attempt
  // of the retry loop below. The version is reassigned inside
  // `createWithVersionRetry` on retry so concurrent creates can't collide
  // on the (organization, featureId, version) unique index.
  const lastRevision = await getLastRevision(context, feature);
  const newVersion = lastRevision ? lastRevision.version + 1 : 1;

  const defaultValue =
    changes && "defaultValue" in changes
      ? changes.defaultValue
      : feature.defaultValue;

  const rules: FeatureRule[] =
    changes && "rules" in changes && changes.rules !== undefined
      ? normalizeRulesInputToV2(changes.rules as unknown, {
          orgEnvs: getEnvironments(context.org),
          featureProject: feature.project,
        })
      : (feature.rules ?? [])
          .filter(isPlausibleFeatureRule)
          .map((r) => upgradeFeatureRule(r));

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
    baseConfig: feature.baseConfig ?? null,
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
          feature,
          version: baseVersion,
        });

  if (!baseRevision) {
    throw new Error("can not find a base revision");
  }
  const status = "draft";
  // Version is initially set to the best-guess `newVersion` so validation
  // hooks see a realistic value. On a duplicate-key collision the retry loop
  // below reassigns it before the actual insert.
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

  // Validation hooks (no-op on cloud; custom user code on self-hosted) MUST
  // run exactly once — keep them outside the retry loop so a duplicate-key
  // race never causes a hook to fire twice.
  await runValidateFeatureRevisionHooks({
    context,
    feature,
    revision,
    original: baseRevision,
  });

  // Retry the insert on duplicate-key collisions from the
  // (organization, featureId, version) unique index. The first attempt uses
  // the already-assigned `newVersion`; on retry we re-read the max version
  // to pick up the concurrent insert that won the previous race, then
  // reassign `revision.version` before retrying.
  let firstAttempt = true;
  const doc = await createWithVersionRetry(async () => {
    if (!firstAttempt) {
      const latest = await getLastRevision(context, feature);
      revision.version = latest ? latest.version + 1 : 1;
    }
    firstAttempt = false;
    return FeatureRevisionModel.create(revision);
  });

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

  return toInterface(doc, context, feature);
}

// Pure computation of what updateRevision() will validate and persist; no writes
export function computeRevisionUpdate(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  changes: RevisionChanges,
  resetReview: boolean,
): {
  normalizedChanges: RevisionChanges;
  status: FeatureRevisionInterface["status"];
  proposedRevision: FeatureRevisionInterface;
  // True when the edit knocked a verdict-bearing status (approved /
  // changes-requested) back to pending-review. Verdicts aren't deleted — they
  // flip to "-stale" variants (see `staleReviews`) so they stay attributable
  // without counting as active verdicts.
  clearReviews: boolean;
  // The `reviews` array to persist when `clearReviews` is true: prior active
  // verdicts demoted to "approved-stale" / "changes-requested-stale".
  staleReviews: FeatureRevisionInterface["reviews"];
} {
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

  // Persistence chokepoint: rules go through `normalizeRulesInputToV2`
  // (also dedups ids and logs collisions). No-op on already-v2 arrays.
  const normalizedChanges: RevisionChanges =
    "rules" in changes && changes.rules !== undefined
      ? {
          ...changes,
          rules: normalizeRulesInputToV2(changes.rules as unknown, {
            orgEnvs: getEnvironments(context.org),
            featureProject: feature.project,
          }),
        }
      : changes;

  const clearReviews =
    status === "pending-review" && revision.status !== "pending-review";
  const staleReviews = clearReviews
    ? (revision.reviews ?? []).map((r) => ({
        ...r,
        status:
          r.status === "approved"
            ? ("approved-stale" as const)
            : r.status === "changes-requested"
              ? ("changes-requested-stale" as const)
              : r.status,
      }))
    : undefined;

  return {
    normalizedChanges,
    status,
    proposedRevision: {
      ...revision,
      ...normalizedChanges,
      status,
      ...(clearReviews ? { reviews: staleReviews } : {}),
    },
    clearReviews,
    staleReviews,
  };
}

// Best-effort early hook run before side-effect writes; updateRevision() re-runs hooks authoritatively
export async function prevalidateRevisionUpdate(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  changes: RevisionChanges,
  resetReview: boolean,
): Promise<void> {
  const { proposedRevision } = computeRevisionUpdate(
    context,
    feature,
    revision,
    changes,
    resetReview,
  );
  await runValidateFeatureRevisionHooks({
    context,
    feature,
    revision: proposedRevision,
    original: revision,
  });
}

export async function updateRevision(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  changes: RevisionChanges,
  log: Omit<RevisionLog, "timestamp">,
  resetReview: boolean,
  // Rebase is the only content-mutating path allowed while "lock edits" is
  // active (keeps the scheduled draft mergeable); all other edits are frozen.
  { bypassScheduleLock = false }: { bypassScheduleLock?: boolean } = {},
) {
  if (!bypassScheduleLock && isRevisionEditLockedBySchedule(revision)) {
    throw new Error(
      "This draft is locked for a scheduled publish. Cancel the schedule before editing.",
    );
  }

  const {
    normalizedChanges,
    status,
    proposedRevision,
    clearReviews,
    staleReviews,
  } = computeRevisionUpdate(context, feature, revision, changes, resetReview);

  await runValidateFeatureRevisionHooks({
    context,
    feature,
    revision: proposedRevision,
    original: revision,
  });

  // Track contributors as user ID strings via atomic $addToSet.
  const contributorId =
    log.user != null && "id" in log.user && log.user.id ? log.user.id : null;
  const contributorUpdate =
    contributorId != null ? { $addToSet: { contributors: contributorId } } : {};

  const doc = await FeatureRevisionModel.findOneAndUpdate(
    {
      organization: revision.organization,
      featureId: revision.featureId,
      version: revision.version,
    },
    {
      $set: {
        ...normalizedChanges,
        status,
        dateUpdated: new Date(),
        // A rebase (baseVersion advances) that keeps the approval standing
        // (review not reset) re-anchors the approval to the new live version.
        // Without this, staleApproval stays true forever and publishing
        // deadlocks under requireRebaseBeforePublish — rebasing never clears it.
        ...(normalizedChanges.baseVersion !== undefined && status === "approved"
          ? { approvedBaseVersion: normalizedChanges.baseVersion }
          : {}),
        // The edit invalidated standing verdicts — demote them to "-stale" so
        // policy hooks and the REST API don't count approvals made against
        // older content, while the UI can still attribute them.
        ...(clearReviews ? { reviews: staleReviews } : {}),
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

  const updatedRevision = doc ? toInterface(doc, context, feature) : null;

  // Fire-and-forget linkage sync whenever draft rules change.
  if (updatedRevision && "rules" in changes) {
    getLinkageSyncRevisionSummaries(revision.organization, revision.featureId)
      .then(({ openDrafts, liveRevision }) =>
        Promise.all([
          syncFeatureExperimentLinkages(
            context,
            revision.featureId,
            openDrafts,
            liveRevision,
          ),
          syncFeatureContextualBanditLinkages(
            context,
            revision.featureId,
            openDrafts,
            liveRevision,
          ),
        ]),
      )
      .catch((e) => {
        logger.error(e, "feature linkage sync failed in updateRevision");
      });
  }

  return updatedRevision;
}

// Pure computation of the changes markRevisionAsPublished() will validate and persist
export function computeRevisionPublishChanges(
  revision: FeatureRevisionInterface,
  user: EventUser,
  comment?: string,
): Partial<FeatureRevisionInterface> {
  return {
    status: "published",
    publishedBy: user,
    datePublished: new Date(),
    dateUpdated: new Date(),
    comment: revision.comment ? revision.comment : comment,
    // Opportunistic disk sync of the computed tuple id for legacy docs
    // (deterministic — see the schema comment); no-op for minted docs.
    ...(revision.id ? { id: revision.id } : {}),
  };
}

export async function markRevisionAsPublished(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  user: EventUser,
  comment?: string,
) {
  // "re-publish" only applies to a revision that was already live; publishing
  // an approved (or otherwise in-flight) draft for the first time is a "publish".
  const action = revision.status === "published" ? "re-publish" : "publish";

  const changes = computeRevisionPublishChanges(revision, user, comment);

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
      // A published revision's schedule and auto-publish arming are spent —
      // disarm so consumers don't see a published revision still "armed".
      $set: { ...changes, autoPublishOnApproval: false },
      $unset: { ...SCHEDULED_PUBLISH_UNSET, autoPublishEnabledBy: 1 },
    },
  );

  // Fire and forget - no route that marks the revision as published expects the log to be there immediately
  // Note: no comment in the payload — publish events are plain lifecycle
  // markers. Any publish-time comment only feeds the revision description
  // fallback (computeRevisionPublishChanges), not the log.
  context.models.featureRevisionLogs
    .create({
      featureId: revision.featureId,
      version: revision.version,
      action,
      subject: "",
      user,
      value: JSON.stringify({}),
    })
    .catch((e) => {
      logger.error(e, "Error creating revisionlog");
    });

  await dispatchRevisionPublishedHook(context, revision);
}

/**
 * Bulk-publish claim: a guarded, side-effect-free publish transition. Guards
 * on the plan-time baseline (status + dateUpdated), so any outside change
 * since planning aborts before any live write. Hooks already ran at plan
 * time; the revision log entry and published-hook dispatch are deferred to
 * emitFeatureRevisionPublishedSideEffects.
 */
export async function claimFeatureRevisionAsPublished(
  revision: FeatureRevisionInterface,
  user: EventUser,
  expected: { status: string; dateUpdated: Date },
  comment?: string,
): Promise<{ claimed: boolean; claimStamp: Date | null }> {
  const changes = computeRevisionPublishChanges(revision, user, comment);
  const outcome = await casUpdate(
    {
      organization: revision.organization,
      featureId: revision.featureId,
      version: revision.version,
    },
    // dateCreated rides along so the fallback below is actually fetched
    // (casUpdate projects guardFields only); it's immutable, so guarding on
    // it is a no-op for the write filter.
    ["status", "dateUpdated", "dateCreated"],
    (current) => {
      if (
        current.status !== expected.status ||
        (current.dateUpdated ?? current.dateCreated)?.getTime() !==
          expected.dateUpdated.getTime()
      ) {
        return null;
      }
      return {
        $set: { ...changes, autoPublishOnApproval: false },
        $unset: { ...SCHEDULED_PUBLISH_UNSET, autoPublishEnabledBy: 1 },
      };
    },
  );
  // The claim's datePublished is its fingerprint: compensation restores the
  // revision only while the doc still carries THIS claim's stamp, so a
  // concurrent legitimate publish (which re-stamps its own datePublished)
  // can't be reverted by our rollback.
  return {
    claimed: outcome === "applied",
    claimStamp: outcome === "applied" ? (changes.datePublished ?? null) : null,
  };
}

/**
 * Compensation for a failed bulk publish: put a claimed revision back to its
 * pre-claim state (status, publish stamps, schedule, arming). Guarded on the
 * claimed "published" status so it can't clobber an unrelated later change.
 */
// Returns whether the revision was actually reopened. It is NOT when the
// claimStamp fingerprint no longer matches (a concurrent legitimate publish
// re-stamped it) — the revision stays published under that other publish, and
// the caller must treat this no-op as a failed release so the item is reported
// stuck-published rather than a clean rollback.
export async function restoreFeatureRevisionAfterFailedBulkPublish(
  original: FeatureRevisionInterface,
  claimStamp: Date | null,
): Promise<boolean> {
  const filter = {
    organization: original.organization,
    featureId: original.featureId,
    version: original.version,
    status: "published" as const,
    // The claim's fingerprint: a concurrent legitimate publish re-stamps
    // datePublished, making this rollback a no-op instead of reverting it.
    ...(claimStamp ? { datePublished: claimStamp } : {}),
  };
  const update = (withLockOthers: boolean) => ({
    $set: {
      status: original.status,
      publishedBy: original.publishedBy ?? null,
      datePublished: original.datePublished ?? null,
      comment: original.comment ?? null,
      ...(original.dateUpdated ? { dateUpdated: original.dateUpdated } : {}),
      autoPublishOnApproval: !!original.autoPublishOnApproval,
      ...(original.autoPublishEnabledBy
        ? { autoPublishEnabledBy: original.autoPublishEnabledBy }
        : {}),
      ...(original.scheduledPublishAt
        ? {
            scheduledPublishAt: original.scheduledPublishAt,
            scheduledPublishLockEdits: original.scheduledPublishLockEdits,
            scheduledPublishLockOthers:
              withLockOthers && original.scheduledPublishLockOthers,
            scheduledPublishBypassApproval:
              original.scheduledPublishBypassApproval,
          }
        : {}),
      ...(original.scheduledPublishAttempts !== undefined
        ? {
            scheduledPublishAttempts: original.scheduledPublishAttempts,
            scheduledPublishLastError:
              original.scheduledPublishLastError ?? null,
            scheduledPublishNextAttemptAt:
              original.scheduledPublishNextAttemptAt ?? null,
            scheduledPublishGaveUpAt: original.scheduledPublishGaveUpAt ?? null,
          }
        : {}),
    },
  });
  try {
    const res = await FeatureRevisionModel.updateOne(filter, update(true));
    return res.matchedCount > 0;
  } catch (e) {
    // A sibling draft armed a lock-others schedule while we held the claim
    // (the claim's $unset freed the partial-index slot). Restore without the
    // lock rather than stranding the revision as published.
    if (!isPublishLockIndexConflict(e)) throw e;
    const res = await FeatureRevisionModel.updateOne(filter, update(false));
    return res.matchedCount > 0;
  }
}

/**
 * The side effects claimFeatureRevisionAsPublished deferred: the revision log
 * entry and the published-hook dispatch. Run by the bulk publisher only after
 * the whole commit succeeded.
 */
export async function emitFeatureRevisionPublishedSideEffects(
  context: ReqContext | ApiReqContext,
  revision: FeatureRevisionInterface,
  user: EventUser,
): Promise<void> {
  const action = revision.status === "published" ? "re-publish" : "publish";
  context.models.featureRevisionLogs
    .create({
      featureId: revision.featureId,
      version: revision.version,
      action,
      subject: "",
      user,
      value: JSON.stringify({}),
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
  {
    autoPublishOnApproval,
    scheduledPublishAt = null,
    scheduledPublishLockEdits,
    scheduledPublishLockOthers,
  }: {
    autoPublishOnApproval?: boolean;
    // When set, arm a deferred publish for this date (implies auto-publish).
    scheduledPublishAt?: Date | null;
    scheduledPublishLockEdits?: boolean;
    scheduledPublishLockOthers?: boolean;
  } = {},
) {
  const action = "Review Requested";

  // A target date implies the unified "armed" auto-publish flag.
  const scheduled = scheduledPublishAt !== null;
  const armed = !!autoPublishOnApproval || scheduled;

  if (scheduled && scheduledPublishLockOthers) {
    await assertNoConflictingPublishLock(
      revision.organization,
      revision.featureId,
      revision.version,
    );
  }

  // The auto-publish later runs with the arming user's authority, so record
  // who that was. Actors without a user ID (e.g. API keys) can still arm —
  // the publish then falls back to `createdBy`.
  const enabledBy = armed && user && "id" in user ? user.id : null;

  const unset: Record<string, 1> = {};
  if (enabledBy === null) unset.autoPublishEnabledBy = 1;
  // Re-requesting review without a (new) schedule clears any stale one. With a
  // new schedule, keep the schedule but still reset prior poller-failure state.
  // Either way clear scheduledPublishBypassApproval — request-review never arms
  // an admin-bypass schedule, so a stale flag from a prior schedule-publish arm
  // must not carry over.
  if (!scheduled) Object.assign(unset, SCHEDULED_PUBLISH_UNSET);
  else
    Object.assign(unset, SCHEDULED_PUBLISH_FAILURE_UNSET, {
      scheduledPublishBypassApproval: 1,
    });

  try {
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
          autoPublishOnApproval: armed,
          ...(scheduled
            ? {
                scheduledPublishAt,
                scheduledPublishLockEdits: !!scheduledPublishLockEdits,
                scheduledPublishLockOthers: !!scheduledPublishLockOthers,
              }
            : {}),
          ...(enabledBy !== null ? { autoPublishEnabledBy: enabledBy } : {}),
          // Requesting review starts a new review cycle — prior verdicts no
          // longer stand (mirrors the revision-log replay semantics).
          reviews: [],
        },
        ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
      },
    );
  } catch (e) {
    if (isPublishLockIndexConflict(e)) {
      throw new Error(PUBLISH_LOCK_CONFLICT_MESSAGE);
    }
    throw e;
  }

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

  // Log the schedule armed with the review request as its own timeline event.
  if (scheduled) {
    logScheduledPublishChange(context, revision, {
      action: "schedule publish",
      scheduledPublishAt: scheduledPublishAt as Date,
      lockEdits: !!scheduledPublishLockEdits,
      lockOthers: !!scheduledPublishLockOthers,
    });
  }
}

export async function setAutoPublishOnApproval(
  revision: FeatureRevisionInterface,
  enabled: boolean,
  // User arming the flag; the auto-publish runs with their authority.
  // Cleared on disable (and on enable without a user ID, where the publish
  // falls back to `createdBy`).
  enabledBy: string | null,
) {
  await FeatureRevisionModel.updateOne(
    {
      organization: revision.organization,
      featureId: revision.featureId,
      version: revision.version,
    },
    enabled && enabledBy !== null
      ? {
          $set: {
            autoPublishOnApproval: true,
            autoPublishEnabledBy: enabledBy,
          },
          // "publish when approved" is mutually exclusive with a date — clear any
          // existing schedule.
          $unset: { ...SCHEDULED_PUBLISH_UNSET },
        }
      : {
          $set: { autoPublishOnApproval: enabled },
          // Disarming drops any pending schedule too.
          $unset: { autoPublishEnabledBy: 1, ...SCHEDULED_PUBLISH_UNSET },
        },
  );
}

// Poller-failure bookkeeping. Cleared on cancel and on every (re)arm so a fresh
// schedule never inherits a prior schedule's "stuck" state or attempt count.
const SCHEDULED_PUBLISH_FAILURE_UNSET = {
  scheduledPublishAttempts: 1,
  scheduledPublishLastError: 1,
  scheduledPublishNextAttemptAt: 1,
  scheduledPublishGaveUpAt: 1,
} as const;

// Schedule fields cleared together on cancel or when leaving the review cycle.
const SCHEDULED_PUBLISH_UNSET = {
  scheduledPublishAt: 1,
  scheduledPublishLockEdits: 1,
  scheduledPublishLockOthers: 1,
  scheduledPublishBypassApproval: 1,
  ...SCHEDULED_PUBLISH_FAILURE_UNSET,
} as const;

export type ScheduledPublishInput = {
  // Target publish date, or null to cancel the schedule (also disarms auto-publish).
  scheduledPublishAt: Date | null;
  lockEdits?: boolean;
  lockOthers?: boolean;
  // Mark the schedule as an admin bypass-approval override. Callers must only
  // pass true after confirming canBypassApprovalChecks. Persisted so the UI can
  // lock the schedule to cancel-and-re-arm; ignored when canceling.
  bypassApproval?: boolean;
};

// Log a schedule change so additions/changes/cancellations show in the review
// timeline. Fire-and-forget, like the other log writers here.
export function logScheduledPublishChange(
  context: ReqContext | ApiReqContext,
  revision: Pick<FeatureRevisionInterface, "featureId" | "version">,
  {
    action,
    scheduledPublishAt,
    lockEdits,
    lockOthers,
  }: {
    action:
      | "schedule publish"
      | "update scheduled publish"
      | "cancel scheduled publish";
    scheduledPublishAt?: Date;
    lockEdits?: boolean;
    lockOthers?: boolean;
  },
) {
  context.models.featureRevisionLogs
    .create({
      featureId: revision.featureId,
      version: revision.version,
      action,
      subject: "",
      user: context.auditUser,
      value: JSON.stringify(
        action === "cancel scheduled publish"
          ? {}
          : {
              scheduledPublishAt,
              lockEdits: !!lockEdits,
              lockOthers: !!lockOthers,
            },
      ),
    })
    .catch((e) => {
      logger.error(e, "Error creating revisionlog for schedule change");
    });
}

// Arm (or cancel) a deferred publish on a revision. Scheduling implies the armed
// auto-publish flag; canceling disarms it. The publish later runs with
// `enabledBy`'s authority (falls back to the draft author when null).
export async function setRevisionScheduledPublish(
  context: ReqContext | ApiReqContext,
  revision: FeatureRevisionInterface,
  {
    scheduledPublishAt,
    lockEdits,
    lockOthers,
    bypassApproval,
  }: ScheduledPublishInput,
  enabledBy: string | null,
) {
  const filter = {
    organization: revision.organization,
    featureId: revision.featureId,
    version: revision.version,
  };

  if (scheduledPublishAt === null) {
    await FeatureRevisionModel.updateOne(filter, {
      $set: { autoPublishOnApproval: false, dateUpdated: new Date() },
      $unset: { ...SCHEDULED_PUBLISH_UNSET, autoPublishEnabledBy: 1 },
    });
    logScheduledPublishChange(context, revision, {
      action: "cancel scheduled publish",
    });
    return;
  }

  if (lockOthers) {
    await assertNoConflictingPublishLock(
      revision.organization,
      revision.featureId,
      revision.version,
    );
  }

  try {
    // Guard against a TOCTOU race: only arm a revision that's still active.
    // Without the status predicate, a revision published/discarded between the
    // caller's read and this write would get schedule/lock fields stamped back
    // onto it — and a stale lock-others doc would keep occupying the partial
    // unique index, blocking future schedules for the feature.
    const { matchedCount } = await FeatureRevisionModel.updateOne(
      { ...filter, status: { $in: [...ACTIVE_DRAFT_STATUSES] } },
      {
        $set: {
          autoPublishOnApproval: true,
          scheduledPublishAt,
          scheduledPublishLockEdits: !!lockEdits,
          scheduledPublishLockOthers: !!lockOthers,
          dateUpdated: new Date(),
          ...(bypassApproval ? { scheduledPublishBypassApproval: true } : {}),
          ...(enabledBy !== null ? { autoPublishEnabledBy: enabledBy } : {}),
        },
        // Clear any prior poller-failure state so a reschedule doesn't keep the
        // "stuck" UI or prematurely escalate logging on the next fire.
        $unset: {
          ...SCHEDULED_PUBLISH_FAILURE_UNSET,
          ...(bypassApproval ? {} : { scheduledPublishBypassApproval: 1 }),
          ...(enabledBy === null ? { autoPublishEnabledBy: 1 } : {}),
        },
      },
    );
    if (!matchedCount) {
      throw new Error(
        "This revision can no longer be scheduled — it was published or discarded.",
      );
    }
  } catch (e) {
    if (isPublishLockIndexConflict(e)) {
      throw new Error(PUBLISH_LOCK_CONFLICT_MESSAGE);
    }
    throw e;
  }

  logScheduledPublishChange(context, revision, {
    // Distinguish a first-time arm from an edit to an already-armed schedule.
    action: revision.scheduledPublishAt
      ? "update scheduled publish"
      : "schedule publish",
    scheduledPublishAt,
    lockEdits: !!lockEdits,
    lockOthers: !!lockOthers,
  });
}

// Record a failed poller attempt so a stuck schedule is visible (UI + REST)
// instead of silently retrying; cleared on the next publish or cancel.
// Intentionally a raw write — no dateUpdated bump, audit, timeline, or webhook —
// so per-tick retries don't generate notification noise. Keep it that way.
export async function recordScheduledPublishFailure(
  revision: Pick<
    FeatureRevisionInterface,
    "organization" | "featureId" | "version"
  >,
  message: string,
): Promise<number> {
  const doc = await FeatureRevisionModel.findOneAndUpdate(
    {
      organization: revision.organization,
      featureId: revision.featureId,
      version: revision.version,
    },
    {
      $set: { scheduledPublishLastError: message },
      $inc: { scheduledPublishAttempts: 1 },
    },
    { new: true },
  ).select("scheduledPublishAttempts");
  return doc?.scheduledPublishAttempts ?? 0;
}

// Delay the next poller retry of a failing scheduled publish (backoff). The
// due-but-failing revision is skipped until this time so doomed retries space
// out instead of firing every tick. Raw write, like the failure recorder.
export async function setScheduledPublishNextAttempt(
  revision: Pick<
    FeatureRevisionInterface,
    "organization" | "featureId" | "version"
  >,
  nextAttemptAt: Date,
): Promise<void> {
  await FeatureRevisionModel.updateOne(
    {
      organization: revision.organization,
      featureId: revision.featureId,
      version: revision.version,
    },
    { $set: { scheduledPublishNextAttemptAt: nextAttemptAt } },
  );
}

// Give up on a failing scheduled publish: clear the schedule (so the poller
// stops selecting it), disarm auto-publish, and stamp scheduledPublishGaveUpAt
// so the UI can flag the abandoned schedule. The draft is left open with
// scheduledPublishLastError preserved for context. Raw write (no dateUpdated
// bump) like the failure recorder — the revision.publishFailed webhook is the
// user-facing signal.
export async function parkScheduledPublish(
  revision: Pick<
    FeatureRevisionInterface,
    "organization" | "featureId" | "version"
  >,
): Promise<void> {
  await FeatureRevisionModel.updateOne(
    {
      organization: revision.organization,
      featureId: revision.featureId,
      version: revision.version,
    },
    {
      $set: {
        scheduledPublishGaveUpAt: new Date(),
        autoPublishOnApproval: false,
      },
      $unset: {
        scheduledPublishAt: 1,
        scheduledPublishLockEdits: 1,
        scheduledPublishLockOthers: 1,
        scheduledPublishBypassApproval: 1,
        scheduledPublishNextAttemptAt: 1,
      },
    },
  );
}

// Cross-org poller query for the Agenda job: every armed revision whose date has
// arrived and is still in an active review cycle. Org-agnostic by design (context
// is resolved per-org downstream).
export async function dangerouslyFindRevisionsDueToPublish(
  now: Date,
): Promise<{ organization: string; featureId: string; version: number }[]> {
  const docs = await FeatureRevisionModel.find(
    {
      autoPublishOnApproval: true,
      scheduledPublishAt: { $lte: now },
      status: { $in: [...ACTIVE_DRAFT_STATUSES] },
    },
    { organization: 1, featureId: 1, version: 1 },
  ).lean();
  return docs
    .filter((d) => d.version !== undefined && d.version !== null)
    .map((d) => ({
      organization: d.organization,
      featureId: d.featureId,
      version: d.version as number,
    }));
}

// True if another revision has a committed "lock other drafts" schedule blocking
// sibling publishes. Only applies once the schedule is committed and no longer
// awaiting approval — status "approved" (approval flow) or "draft" (no-approval
// flow); "pending-review"/"changes-requested" don't freeze others.
export async function hasPublishLockingScheduledSibling(
  organization: string,
  featureId: string,
  excludeVersion: number,
): Promise<boolean> {
  const doc = await FeatureRevisionModel.findOne({
    organization,
    featureId,
    version: { $ne: excludeVersion },
    autoPublishOnApproval: true,
    scheduledPublishLockOthers: true,
    status: { $in: ["approved", "draft"] },
  }).select("_id");
  return !!doc;
}

const PUBLISH_LOCK_CONFLICT_MESSAGE =
  "Another draft of this feature already has a scheduled publish that locks other drafts. Cancel it before scheduling another.";

// Reject arming a second "lock other drafts" schedule on a feature — two would
// mutually block each other at fire time and hold forever. Fast pre-check for a
// clear error; the partial unique index is the atomic guard against the race.
async function assertNoConflictingPublishLock(
  organization: string,
  featureId: string,
  version: number,
) {
  const conflict = await FeatureRevisionModel.findOne({
    organization,
    featureId,
    version: { $ne: version },
    autoPublishOnApproval: true,
    scheduledPublishLockOthers: true,
    scheduledPublishAt: { $ne: null },
    status: { $in: [...ACTIVE_DRAFT_STATUSES] },
  }).select("version");
  if (conflict) {
    throw new Error(
      `Revision ${conflict.version} already has a scheduled publish that locks other drafts. Cancel it before scheduling another.`,
    );
  }
}

// True for the duplicate-key error from the lock-others partial unique index —
// i.e. a concurrent arming request won the race for this feature's lock.
function isPublishLockIndexConflict(e: unknown): boolean {
  return (
    !!e &&
    typeof e === "object" &&
    (e as { code?: number }).code === 11000 &&
    String((e as { message?: string }).message ?? "").includes(
      PUBLISH_LOCK_OTHERS_INDEX,
    )
  );
}

// Cancel pending schedules across a feature's revisions (e.g. on archive).
// Disarms and clears schedule/locks; safe to call when none are pending.
// Logs a cancellation against each affected revision so the timeline reflects it.
// find→updateMany isn't atomic: a schedule armed between the two is still cleared
// (same filter) but won't get a timeline entry. Accepted — log completeness only.
export async function cancelScheduledPublishesForFeature(
  context: ReqContext | ApiReqContext,
  organization: string,
  featureId: string,
) {
  const affected = await FeatureRevisionModel.find({
    organization,
    featureId,
    autoPublishOnApproval: true,
    scheduledPublishAt: { $exists: true, $ne: null },
  }).select("version");

  if (!affected.length) return;

  await FeatureRevisionModel.updateMany(
    {
      organization,
      featureId,
      autoPublishOnApproval: true,
      scheduledPublishAt: { $exists: true, $ne: null },
    },
    {
      $set: { autoPublishOnApproval: false, dateUpdated: new Date() },
      $unset: { ...SCHEDULED_PUBLISH_UNSET, autoPublishEnabledBy: 1 },
    },
  );

  for (const doc of affected) {
    logScheduledPublishChange(
      context,
      { featureId, version: doc.version },
      { action: "cancel scheduled publish" },
    );
  }
}

// Compare-and-swap update: read `guardFields`, derive an update from the
// current doc, then write only if those fields are unchanged — retrying on a
// lost race. `build` returning null aborts. Lets concurrent reviewers reconcile
// shared fields without an aggregation-pipeline update (DocumentDB/Cosmos reject
// those). Mirrors RevisionModel.casUpdate.
async function casUpdate(
  filter: mongoose.FilterQuery<FeatureRevisionInterface>,
  guardFields: (keyof FeatureRevisionInterface)[],
  build: (
    current: Partial<FeatureRevisionInterface>,
  ) =>
    | mongoose.UpdateQuery<FeatureRevisionInterface>
    | null
    | Promise<mongoose.UpdateQuery<FeatureRevisionInterface> | null>,
  maxAttempts = 5,
): Promise<"applied" | "aborted" | "exhausted"> {
  const projection = Object.fromEntries(guardFields.map((f) => [f, 1]));
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const current = await FeatureRevisionModel.findOne(
      filter,
      projection,
    ).lean<Partial<FeatureRevisionInterface> | null>();
    if (!current) return "aborted";
    const update = await build(current);
    if (!update) return "aborted";
    // Missing fields guard on absence so legacy self-heal writes stay correct.
    const guard = Object.fromEntries(
      guardFields.map((f) => [
        f,
        current[f] === undefined ? { $exists: false } : current[f],
      ]),
    );
    const res = await FeatureRevisionModel.updateOne(
      { ...filter, ...guard },
      update,
    );
    if (res.matchedCount > 0) return "applied";
  }
  return "exhausted";
}

export async function submitReviewAndComments(
  context: ReqContext | ApiReqContext,
  revision: FeatureRevisionInterface,
  user: EventUser,
  reviewSubmittedType: ReviewSubmittedType,
  comment?: string,
  // Current live feature version, captured on approval so we can later detect
  // when an approval has gone stale (live advanced past the approved point).
  liveVersion?: number,
) {
  const action = reviewSubmittedType;

  const filter = {
    organization: revision.organization,
    featureId: revision.featureId,
    version: revision.version,
  };

  // Bake this reviewer's verdict into the revision's `reviews` array so
  // consumers (custom hooks, API) don't have to replay the log. Plain
  // comments don't carry a verdict; system/anonymous users are skipped.
  const verdict =
    reviewSubmittedType === "Approved"
      ? ("approved" as const)
      : reviewSubmittedType === "Requested Changes"
        ? ("changes-requested" as const)
        : null;
  const reviewerKey = reviewerKeyForEventUser(user);
  const newReview: RevisionReview | null =
    verdict !== null && reviewerKey !== null
      ? { userId: reviewerKey, user, status: verdict, timestamp: new Date() }
      : null;

  // `status` aggregates ALL standing verdicts — one reviewer's approval must
  // not override another reviewer's active changes-requested. Stale verdicts
  // don't count, and comments never change the status.
  if (newReview !== null) {
    // Step 1: bake this reviewer's verdict, scoped to their own entry so
    // concurrent verdicts converge to one entry per reviewer.
    // Legacy revision (no baked `reviews`): self-heal from the log, CAS-guarded
    // on the field still being absent so concurrent first-verdicts don't clobber.
    let seeded = false;
    if (revision.reviews === undefined) {
      const priorReviews = await getActiveReviewsFromLog(context, revision);
      const outcome = await casUpdate(filter, ["reviews"], (current) =>
        current.reviews === undefined
          ? {
              $set: {
                reviews: [
                  ...priorReviews.filter((r) => r.userId !== newReview.userId),
                  newReview,
                ],
                datePublished: null,
                dateUpdated: new Date(),
              },
            }
          : null,
      );
      seeded = outcome === "applied";
    }
    if (!seeded) {
      // $pull then $push (Mongo can't do both on one field at once); each op is
      // atomic and scoped to this reviewer's userId.
      await FeatureRevisionModel.updateOne(filter, {
        $pull: { reviews: { userId: newReview.userId } },
      });
      await FeatureRevisionModel.updateOne(filter, {
        $push: { reviews: newReview },
        $set: { datePublished: null, dateUpdated: new Date() },
      });
    }

    // Step 2: reconcile `status` from the stored reviews (CAS-guarded on both
    // `reviews` and `status`) so it can't drift from a concurrent verdict.
    // Bail if a concurrent recall/discard moved us out of the review cycle —
    // otherwise we'd resurrect "pending-review" over their "draft". Record
    // approvedBaseVersion for later staleness detection when approved.
    const outcome = await casUpdate(
      filter,
      ["reviews", "status"],
      (current) => {
        if (
          !(
            ["pending-review", "changes-requested", "approved"] as string[]
          ).includes(current.status ?? "")
        ) {
          return null;
        }
        const reviews = current.reviews ?? [];
        const status = reviews.some((r) => r.status === "changes-requested")
          ? "changes-requested"
          : reviews.some((r) => r.status === "approved")
            ? "approved"
            : "pending-review";
        return {
          $set: {
            status,
            ...(status === "approved" && liveVersion !== undefined
              ? { approvedBaseVersion: liveVersion }
              : {}),
          },
        };
      },
    );
    if (outcome === "exhausted") {
      logger.warn(
        `submitReviewAndComments: status reconcile exhausted retries for ${revision.featureId}#${revision.version}`,
      );
    }
  } else if (verdict !== null) {
    // Verdict from a user without a stable reviewer key (e.g. system events)
    // can't be baked into `reviews`; fall back to latest-verdict-wins.
    const status = verdict === "approved" ? "approved" : "changes-requested";
    await FeatureRevisionModel.updateOne(filter, {
      $set: {
        status,
        datePublished: null,
        dateUpdated: new Date(),
        ...(status === "approved" && liveVersion !== undefined
          ? { approvedBaseVersion: liveVersion }
          : {}),
      },
    });
  }
  // Plain comment (verdict === null): don't touch the revision. It's logged as
  // its own entry below; bumping `dateUpdated` would falsely signal a content
  // change to the rebase guard (expectedDraftDateUpdated) and "last modified" UI.

  // A changes-requested verdict cancels any pending schedule so it can't fire on
  // a stale approval. Gate the clear on the schedule still being set so concurrent
  // changes-requested verdicts don't each log a duplicate cancellation — only the
  // writer that actually clears it (modifiedCount > 0) logs.
  if (verdict === "changes-requested") {
    const res = await FeatureRevisionModel.updateOne(
      { ...filter, scheduledPublishAt: { $exists: true, $ne: null } },
      {
        $set: { autoPublishOnApproval: false, dateUpdated: new Date() },
        $unset: { ...SCHEDULED_PUBLISH_UNSET, autoPublishEnabledBy: 1 },
      },
    );
    if (res.modifiedCount > 0) {
      logScheduledPublishChange(context, revision, {
        action: "cancel scheduled publish",
      });
    }
  }

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

// Retract a review request: pending-review / changes-requested / approved back
// to draft. Callers gate on canManageFeatureDrafts (any draft manager, not just
// the requester), matching request-review. Log entries are preserved.
export async function recallReview(
  context: ReqContext | ApiReqContext,
  revision: FeatureRevisionInterface,
  user: EventUser,
) {
  const allowed = ["pending-review", "changes-requested", "approved"] as const;
  if (!(allowed as readonly string[]).includes(revision.status)) {
    throw new Error(
      `Can only recall a review on a pending-review, changes-requested, or approved draft (status is "${revision.status}")`,
    );
  }

  await FeatureRevisionModel.updateOne(
    {
      organization: revision.organization,
      featureId: revision.featureId,
      version: revision.version,
    },
    {
      // Recalling restarts the review lifecycle: clear verdicts and disarm any
      // auto/deferred publish (re-specified on the next Request Review).
      $set: {
        status: "draft",
        dateUpdated: new Date(),
        reviews: [],
        autoPublishOnApproval: false,
      },
      $unset: {
        approvedBaseVersion: 1,
        autoPublishEnabledBy: 1,
        ...SCHEDULED_PUBLISH_UNSET,
      },
    },
  );

  context.models.featureRevisionLogs
    .create({
      featureId: revision.featureId,
      version: revision.version,
      action: "Recall Review",
      subject: "",
      user,
      value: JSON.stringify({}),
    })
    .catch((e) => {
      logger.error(e, "Error creating revisionlog for recallReview");
    });

  // Recall disarms any pending schedule — record the cancellation in the timeline.
  if ((revision.scheduledPublishAt ?? null) !== null) {
    logScheduledPublishChange(context, revision, {
      action: "cancel scheduled publish",
    });
  }
}

// Replay the review lifecycle from the merged log to find each reviewer's
// active verdict. `Review Requested` / `Recall Review` / `reopen` start a new
// cycle (clearing all verdicts); `Undo Review` removes that reviewer's verdict.
// Returns entries in the baked `reviews` shape so callers can use it as a
// drop-in fallback for revisions that predate the denormalized field.
export function activeReviewsFromLog(
  entries: { action: string; user: EventUser; timestamp: Date }[],
): RevisionReview[] {
  const sorted = [...entries].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );
  const byReviewer = new Map<string, RevisionReview>();
  for (const entry of sorted) {
    if (
      entry.action === "Review Requested" ||
      entry.action === "Recall Review" ||
      entry.action === "reopen"
    ) {
      byReviewer.clear();
      continue;
    }
    const key = reviewerKeyForEventUser(entry.user);
    if (key === null) continue;
    if (entry.action === "Approved" || entry.action === "Requested Changes") {
      byReviewer.set(key, {
        userId: key,
        user: entry.user,
        status: entry.action === "Approved" ? "approved" : "changes-requested",
        timestamp: entry.timestamp,
      });
    } else if (entry.action === "Undo Review") {
      byReviewer.delete(key);
    }
  }
  return Array.from(byReviewer.values());
}

// Reconstruct active reviewer verdicts by merging the legacy inline log with
// the dedicated log collection and replaying the review lifecycle. Used as a
// fallback for revisions created before the baked `reviews` field existed —
// prefer `revision.reviews` when defined.
export async function getActiveReviewsFromLog(
  context: ReqContext | ApiReqContext,
  revision: Pick<
    FeatureRevisionInterface,
    "organization" | "featureId" | "version"
  >,
): Promise<RevisionReview[]> {
  const docWithLog = await FeatureRevisionModel.findOne(
    {
      organization: revision.organization,
      featureId: revision.featureId,
      version: revision.version,
    },
    { log: 1 },
  );
  const modernLogs =
    await context.models.featureRevisionLogs.getAllByFeatureIdAndVersion({
      featureId: revision.featureId,
      version: revision.version,
    });
  return activeReviewsFromLog([
    ...(docWithLog?.log ?? []).map((entry) => ({
      action: entry.action,
      user: entry.user,
      timestamp: new Date(entry.timestamp),
    })),
    ...modernLogs.map((entry) => ({
      action: entry.action,
      user: entry.user,
      timestamp: new Date(entry.dateCreated),
    })),
  ]);
}

// Reviewer retracts their own verdict. Rather than blanket-reverting to
// pending-review, rewind to the state implied by the *remaining* active
// verdicts: any outstanding Requested Changes → changes-requested, else any
// outstanding Approved → approved, else pending-review. Review comments
// remain in the log.
export async function undoReview(
  context: ReqContext | ApiReqContext,
  revision: FeatureRevisionInterface,
  user: EventUser,
) {
  const allowed = ["approved", "changes-requested"] as const;
  if (!(allowed as readonly string[]).includes(revision.status)) {
    throw new Error(
      `Can only undo a review on an approved or changes-requested draft (status is "${revision.status}")`,
    );
  }

  const retractingKey = reviewerKeyForEventUser(user);
  // Keyless callers (e.g. system events) never hold a baked verdict to undo.
  if (retractingKey === null) {
    throw new Error("You have no active review verdict to undo");
  }

  const filter = {
    organization: revision.organization,
    featureId: revision.featureId,
    version: revision.version,
  };

  // Rewind to the state implied by the *remaining* verdicts, CAS-guarded on
  // `reviews`+`status` so a verdict another reviewer landed concurrently isn't
  // clobbered by the wholesale rewrite. Modern revisions store verdicts in
  // `reviews`; legacy ones only in the log (the helper guards on the field's
  // continued absence so we self-heal from the log just once).
  let resolved: "approved" | "changes-requested" | "pending-review" | null =
    null;
  const outcome = await casUpdate(
    filter,
    ["reviews", "status"],
    async (current) => {
      if (!(allowed as readonly string[]).includes(current.status ?? "")) {
        throw new Error(
          `Can only undo a review on an approved or changes-requested draft (status is "${current.status}")`,
        );
      }
      const activeReviews =
        current.reviews ?? (await getActiveReviewsFromLog(context, revision));
      // Only a reviewer with an active verdict can undo one — otherwise we'd
      // write a phantom "Undo Review" entry and bump dateUpdated for nothing.
      if (!activeReviews.some((r) => r.userId === retractingKey)) {
        throw new Error("You have no active review verdict to undo");
      }
      const remaining = activeReviews.filter((r) => r.userId !== retractingKey);
      resolved = remaining.some((r) => r.status === "changes-requested")
        ? "changes-requested"
        : remaining.some((r) => r.status === "approved")
          ? "approved"
          : "pending-review";
      return {
        // Writing `remaining` wholesale (rather than $pull) also self-heals
        // legacy revisions whose verdicts only existed in the log.
        $set: { status: resolved, dateUpdated: new Date(), reviews: remaining },
        // An approval that still stands keeps its recorded base version.
        ...(resolved === "approved"
          ? {}
          : { $unset: { approvedBaseVersion: 1 } }),
      };
    },
  );
  if (outcome === "aborted") {
    throw new Error("Could not find feature revision");
  }
  if (outcome === "exhausted" || resolved === null) {
    throw new Error(
      "Could not undo review due to a concurrent update. Please retry.",
    );
  }
  const status = resolved;

  context.models.featureRevisionLogs
    .create({
      featureId: revision.featureId,
      version: revision.version,
      action: "Undo Review",
      subject: "",
      user,
      value: JSON.stringify({}),
    })
    .catch((e) => {
      logger.error(e, "Error creating revisionlog for undoReview");
    });

  // Return the resolved status so callers can trigger auto-publish when undoing
  // a "changes-requested" verdict flips the revision to "approved".
  return status;
}

// Reopen a discarded revision as a plain draft. Any prior review state is
// intentionally not restored — the draft must go back through review.
export async function reopenRevision(
  context: ReqContext | ApiReqContext,
  revision: FeatureRevisionInterface,
  user: EventUser,
) {
  if (revision.status !== "discarded") {
    throw new Error(`Can only reopen discarded revisions`);
  }

  await FeatureRevisionModel.updateOne(
    {
      organization: revision.organization,
      featureId: revision.featureId,
      version: revision.version,
    },
    {
      // Reopening starts the review lifecycle over — clear baked verdicts,
      // the recorded approval point, and the auto-publish opt-in so a stale
      // approval can't carry over (mirrors recallReview).
      $set: {
        status: "draft",
        dateUpdated: new Date(),
        reviews: [],
        autoPublishOnApproval: false,
      },
      $unset: {
        approvedBaseVersion: 1,
        autoPublishEnabledBy: 1,
        ...SCHEDULED_PUBLISH_UNSET,
      },
    },
  );

  // Fire and forget — callers don't depend on the log entry being there
  context.models.featureRevisionLogs
    .create({
      featureId: revision.featureId,
      version: revision.version,
      action: "reopen",
      subject: "",
      user,
      value: JSON.stringify({}),
    })
    .catch((e) => {
      logger.error(e, "Error creating revisionlog");
    });

  // Sync linkages — the reopened revision's rules count as "open drafts" again.
  getLinkageSyncRevisionSummaries(revision.organization, revision.featureId)
    .then(({ openDrafts, liveRevision }) =>
      syncFeatureExperimentLinkages(
        context,
        revision.featureId,
        openDrafts,
        liveRevision,
      ),
    )
    .catch((e) => {
      logger.error(e, "syncFeatureExperimentLinkages failed in reopenRevision");
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
      // Discarding a revision also disarms auto-publish so the dead revision
      // doesn't surface as armed via the API (mirrors recallReview/reopenRevision).
      $set: {
        status: "discarded",
        dateUpdated: new Date(),
        autoPublishOnApproval: false,
      },
      $unset: { ...SCHEDULED_PUBLISH_UNSET, autoPublishEnabledBy: 1 },
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

  // Sync linkages — the discarded revision's rules no longer count as "open drafts".
  getLinkageSyncRevisionSummaries(revision.organization, revision.featureId)
    .then(({ openDrafts, liveRevision }) =>
      Promise.all([
        syncFeatureExperimentLinkages(
          context,
          revision.featureId,
          openDrafts,
          liveRevision,
        ),
        syncFeatureContextualBanditLinkages(
          context,
          revision.featureId,
          openDrafts,
          liveRevision,
        ),
      ]),
    )
    .catch((e) => {
      logger.error(e, "feature linkage sync failed in discardRevision");
    });
}

export async function getFeatureRevisionsByFeatureIds(
  context: ReqContext | ApiReqContext,
  organization: string,
  featureIds: string[],
  // Map of featureId -> parent feature. Drives env applicability filtering
  // and v2 inheritance expansion per revision so a feature scoped to a
  // project that excludes some envs doesn't surface dead rules in those envs.
  featuresByFeatureId: Record<string, RevisionFeatureContext | undefined>,
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
      revisionsByFeatureId[featureId].push(
        toInterface(revision, context, featuresByFeatureId[featureId]),
      );
    });
  }

  return revisionsByFeatureId;
}

export type DraftStatusCounts = Partial<Record<ActiveDraftStatus, number>>;

export async function getActiveDraftStates(
  orgId: string,
  featureIds?: string[],
): Promise<Record<string, DraftStatusCounts>> {
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
    _id: 0,
  });

  const result: Record<string, DraftStatusCounts> = {};
  for (const doc of docs) {
    const fid = doc.featureId;
    const status = doc.status as ActiveDraftStatus;
    if (!result[fid]) result[fid] = {};
    result[fid][status] = (result[fid][status] ?? 0) + 1;
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

  const featureById: Record<string, FeatureInterface> = Object.fromEntries(
    features.map((f) => [f.id, f]),
  );
  return docs.map((m) => toInterface(m, context, featureById[m.featureId]));
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
