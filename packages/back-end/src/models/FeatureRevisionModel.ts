import mongoose from "mongoose";
import omit from "lodash/omit";
import { checkIfRevisionNeedsReview } from "shared/util";
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

/** Returns the version/status/rules of all non-discarded revisions for a feature.
 * Used by syncFeatureExperimentLinkages callers that don't already have the
 * Mongoose model in scope. */
export async function getNonDiscardedRevisionSummaries(
  organization: string,
  featureId: string,
): Promise<Pick<FeatureRevisionInterface, "version" | "status" | "rules">[]> {
  const docs = await FeatureRevisionModel.find({
    organization,
    featureId,
    status: { $nin: ["discarded"] },
  }).select("version status rules");
  return docs.map((d) => ({
    version: d.version,
    status: d.status,
    rules: d.rules,
  }));
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
    ...(m.contributors?.length
      ? {
          contributors: migrateContributors(
            m.contributors as unknown as unknown[],
          ),
        }
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

  await runValidateFeatureRevisionHooks({
    context,
    feature,
    revision: {
      ...revision,
      ...normalizedChanges,
      status,
    },
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
    FeatureRevisionModel.find({
      organization: revision.organization,
      featureId: revision.featureId,
      status: { $nin: ["discarded"] },
    })
      .then((docs) =>
        syncFeatureExperimentLinkages(
          context,
          revision.featureId,
          docs.map((d) => ({
            version: d.version,
            status: d.status,
            rules: d.rules,
          })),
        ),
      )
      .catch((e) => {
        logger.error(
          e,
          "syncFeatureExperimentLinkages failed in updateRevision",
        );
      });
  }

  return updatedRevision;
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

  // Sync linkages — the discarded revision's rules no longer count as "open drafts".
  FeatureRevisionModel.find({
    organization: revision.organization,
    featureId: revision.featureId,
    status: { $nin: ["discarded"] },
  })
    .then((docs) =>
      syncFeatureExperimentLinkages(
        context,
        revision.featureId,
        docs.map((d) => ({
          version: d.version,
          status: d.status,
          rules: d.rules,
        })),
      ),
    )
    .catch((e) => {
      logger.error(
        e,
        "syncFeatureExperimentLinkages failed in discardRevision",
      );
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
