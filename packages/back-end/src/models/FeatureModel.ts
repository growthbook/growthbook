import mongoose, { FilterQuery } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import cloneDeep from "lodash/cloneDeep";
import omit from "lodash/omit";
import isEqual from "lodash/isEqual";
import {
  MergeResultChanges,
  checkIfRevisionNeedsReview,
  autoMerge,
  liveRevisionFromFeature,
  PermissionError,
  rampRuleEnvKey,
  stemRuleId,
  resolveTargetingProjectIds,
  computeHoldoutExperimentLinkageDelta,
  getExperimentIdsFromRules,
} from "shared/util";
import {
  SafeRolloutInterface,
  SafeRolloutRule,
  simpleSchemaValidator,
  RampScheduleInterface,
  RampScheduleTemplateInterface,
  RevisionRampAction,
  RevisionRampCreateAction,
  RevisionRampUpdateAction,
  RampStepAction,
  resolveStartApproval,
} from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
import {
  FeatureEnvironment,
  FeatureInterface,
  FeatureMetaInfo,
  FeatureRule,
  JSONSchemaDef,
  LegacyFeatureInterface,
  V1FeatureInterface,
  V1FeatureRule,
} from "shared/types/feature";
import { EventUser } from "shared/types/events/event-types";
import { OrganizationInterface } from "shared/types/organization";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ResourceEvents } from "shared/types/events/base-types";
import { DiffResult } from "shared/types/events/diff";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import {
  runGuardedWrite,
  withBufferedPayloadRefreshes,
} from "back-end/src/revisions/landingSequence";
import {
  assertCanPublishFeatureRevision,
  mergeResultTouchesPayload,
} from "back-end/src/revisions/featureDraftAuthority";
import {
  getMergeResultPublishEnvs,
  addIdsToFlatRules,
  getApiFeatureObj,
  getNextScheduledUpdate,
  getSavedGroupMap,
  queueSDKPayloadRefresh,
  synthesizeRuleId,
} from "back-end/src/services/features";
import {
  advancedGuardStamp,
  CasConflictError,
} from "back-end/src/models/BaseModel";
import {
  assertConfigBackedDefaultHasNoOverrides,
  assertConfigBackedFeatureValuesValid,
  configCheckedRuleValues,
} from "back-end/src/services/configValidation";
import {
  appendRampEvent,
  assertFeatureNotLockedByRamp,
  computeNextProcessAt,
  ensureSafeRolloutForMonitoredRamp,
  getStartActionsFromRules,
  mergeStepsForRunningSchedule,
  remapTemplateActions,
  runLockedRampScheduleAction,
  startReadyScheduleNow,
  syncLinkedSafeRolloutForRampState,
} from "back-end/src/services/rampSchedule";
import {
  applyNonRuleFeatureUpgrades,
  pinLegacyRolloutSeeds,
  upgradeFeatureRule,
  upgradeV0Feature,
} from "back-end/src/util/migrations";
import {
  resolveRampTargets,
  ensureUniqueRuleIds,
  flattenV1ToV2Rules,
  getApplicableEnvIds,
  isPlausibleFeatureRule,
  V1RulesByEnv,
} from "back-end/src/util/flattenRules";
import { overlayDocsById } from "back-end/src/util/scanOverlay.util";
import { ReqContext } from "back-end/types/request";
import {
  applyEnvironmentInheritance,
  buildInheritedChildrenByAncestor,
  expandRuleEnvsForInheritance,
  getAffectedSDKPayloadKeys,
  getSDKPayloadKeysByDiff,
} from "back-end/src/util/features";
import {
  assertHoldoutAvailableForProject,
  getHoldoutAvailableForProject,
} from "back-end/src/services/holdout-availability";
import { applyPartialFeatureRuleUpdatesToRevision } from "back-end/src/util/featureRevision.util";
import {
  BadRequestError,
  getErrorMessage,
  NotFoundError,
} from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import {
  applyFeatureContextualBanditLinkage,
  planFeatureContextualBanditLinkage,
  referencesAnyContextualBandit,
  reverseFeatureContextualBanditLinkage,
} from "back-end/src/util/featureContextualBanditSync";
import { ownedRestoreValues } from "back-end/src/revisions/bulkPublish/ownedRestore";
import {
  makeBlockingGate,
  type PublishGate,
} from "back-end/src/revisions/publishGates";
import {
  getContextForAgendaJobByOrgId,
  getEnvironmentIdsFromOrg,
} from "back-end/src/services/organizations";
import { getEnvironments } from "back-end/src/util/organization.util";
import { ApiReqContext } from "back-end/types/api";
import { deriveLiveFeatureEventEnvironments } from "back-end/src/events/eventEnvironments";
import {
  captureEventBuffer,
  emitOrDeferBulkPublishEvent,
  entityKey,
} from "back-end/src/events/bulkPublishCorrelation";
import { determineNextSafeRolloutSnapshotAttempt } from "back-end/src/enterprise/saferollouts/safeRolloutUtils";
import {
  createVercelExperimentationItemFromFeature,
  updateVercelExperimentationItemFromFeature,
  deleteVercelExperimentationItemFromFeature,
} from "back-end/src/services/vercel-native-integration.service";
import { getObjectDiff } from "back-end/src/events/handlers/webhooks/event-webhooks-utils";
import {
  runValidateFeatureHooks,
  runValidateFeatureRevisionHooks,
} from "back-end/src/enterprise/sandbox/sandbox-eval";
import {
  createEvent,
  hasPreviousObject,
  CreateEventData,
  CreateEventParams,
} from "./EventModel";
import {
  addLinkedFeatureToExperiment,
  clearPendingFeatureDraftsForRevision,
  getExperimentById,
  getExperimentMapForFeature,
  removeLinkedFeatureFromExperiment,
  updateExperiment,
} from "./ExperimentModel";
import {
  cancelScheduledPublishesForFeature,
  createInitialRevision,
  createRevisionFromLegacyDraft,
  deleteAllRevisionsForFeature,
  getLinkageSyncRevisionSummaries,
  getRevision,
  hasPublishLockingScheduledSibling,
  markRevisionAsPublished,
  computeRevisionPublishChanges,
  restoreFeatureRevisionAfterFailedBulkPublish,
  updateRevision,
  createRevision,
  prepareFeatureRevision,
} from "./FeatureRevisionModel";

const featureSchema = new mongoose.Schema({
  id: String,
  archived: Boolean,
  description: String,
  organization: String,
  nextScheduledUpdate: Date,
  owner: String,
  project: String,
  targetingAllProjects: Boolean,
  targetingProjects: [String],
  dateCreated: Date,
  dateUpdated: Date,
  version: Number,
  valueType: String,
  defaultValue: String,
  baseConfig: String,
  environments: [String],
  tags: [String],
  // `rules` and `environmentSettings` are declared Mixed intentionally —
  // validation lives in Zod schemas (shared/validators/features.ts) and
  // Mongoose's default strict mode would silently drop v2 fields
  // (`allEnvironments`, `environments`) not declared in a sub-schema.
  rules: {},
  prerequisites: [
    {
      _id: false,
      id: String,
      condition: String,
    },
  ],
  environmentSettings: {},
  draft: {},
  legacyDraftMigrated: Boolean,
  revision: {},
  linkedExperiments: [String],
  jsonSchema: {},
  neverStale: Boolean,
  customFields: {},
  holdout: {
    id: String,
    value: String,
  },
});

featureSchema.index({ id: 1, organization: 1 }, { unique: true });
featureSchema.index({ organization: 1, project: 1 });
featureSchema.index({ organization: 1, targetingProjects: 1 });

type FeatureDocument = mongoose.Document & LegacyFeatureInterface;

export const FeatureModel = mongoose.model<LegacyFeatureInterface>(
  "Feature",
  featureSchema,
);

// JIT-migration chokepoint for features on read. Discriminates v0 / v1 / v2
// (see `shared/types/feature.d.ts`) and normalizes to v2. Any residual
// `env.rules` is scrubbed in-memory so the return value matches `featureEnvironment`.
//
// v2 docs MUST NOT flow through `upgradeV0Feature` — it redistributes top-level
// rules back into per-env arrays and corrupts v2 data.
//
// Pure over `(raw, context)` so it's unit-testable without a live DB.
export function migrateRawFeatureToV2(
  raw: LegacyFeatureInterface,
  context: ReqContext | ApiReqContext,
): FeatureInterface {
  // Backfill (dev/production) keeps env-less orgs from dropping every rule
  // through `flattenV1ToV2Rules`'s applicableEnvs filter.
  const orgEnvs = getEnvironments(context.org);

  // v0 is identified by the absence of `environmentSettings`.
  const hasEnvSettings = !!raw.environmentSettings;

  // Capture the v0-style top-level `environments` array BEFORE the omit
  // below strips it. Used for hybrid-v0/v1 docs where
  // `environmentSettings.<env>` was authored without `enabled`.
  const v0EnvironmentsArray: string[] = Array.isArray(
    (raw as { environments?: unknown }).environments,
  )
    ? ((raw as { environments?: string[] }).environments as string[])
    : [];

  // Post-v0-normalization doc; v1-vs-v2 classification is still pending and
  // happens via `topLevelRulesAreV2Shaped` below.
  let postV0Doc: V1FeatureInterface;
  if (!hasEnvSettings) {
    postV0Doc = upgradeV0Feature(raw);
  } else {
    // v2 top-level `rules` must NOT route through `upgradeV0Feature` — it
    // would redistribute them back into v1 per-env arrays. Strip
    // `environments` crust + the legacy embedded `revision` sub-doc to
    // match origin/main `upgradeFeatureInterface`'s destructure.
    const legacyRevisionVersion = (raw as { revision?: { version?: number } })
      .revision?.version;
    postV0Doc = omit(raw, ["environments", "revision"]) as V1FeatureInterface;
    // Legacy version backfill: sparse docs that never lifted `version` out
    // of the embedded `revision` sub-doc fall through to it before the
    // `|| 1` floor in `applyNonRuleFeatureUpgrades`.
    postV0Doc.version = postV0Doc.version || legacyRevisionVersion || 1;
    applyNonRuleFeatureUpgrades(postV0Doc);
  }

  const envSettings = postV0Doc.environmentSettings || {};

  // v2 detection: the doc has v2-shaped top-level rules (every rule we write
  // via `flattenV1ToV2Rules` carries either `allEnvironments` or
  // `environments`, so their presence on any rule is a reliable v2 marker).
  //
  // We INTENTIONALLY do NOT also require `hasNoV1EnvRules(envSettings)` here.
  // A pre-hotfix write path could leave stale `environmentSettings.{env}.rules`
  // on disk while writing a fresh v2 top-level array. Gating on env.rules
  // emptiness made those docs route through the v1 path on every read,
  // silently shadowing the authoritative v2 rules and breaking publish/SDK
  // diffs (see hotfix #5783). The v2 path's own `scrubEnvRules` strips the
  // legacy key from the in-memory output, so stale env.rules can't leak.
  //
  // Hybrid v0/v1 docs (legacy top-level `rules` left behind alongside an
  // `environmentSettings` map) are still safe: v0 rules don't carry
  // `allEnvironments`/`environments`, so `topLevelRulesAreV2Shaped` is false
  // and we fall to the v1 path correctly.
  const topLevelRules = ((postV0Doc as { rules?: unknown[] }).rules ??
    []) as Array<Record<string, unknown>>;
  const topLevelRulesAreV2Shaped = topLevelRules.some(
    (r) =>
      r &&
      typeof r === "object" &&
      ("allEnvironments" in r || "environments" in r),
  );

  // Mirror origin/main's `updateEnvironmentSettings` for dev/production:
  //   • rules:    backfill from top-level rules (only if v0-shaped).
  //   • enabled:  backfill from the v0 `environments` array.
  // Hybrid v0/v1 docs need the `enabled` half: an env listed in the v0 array
  // but absent from envSettings would otherwise read as `enabled: false` and
  // silently disable a previously-live env.
  const shouldBackfillRulesFromTopLevel =
    !topLevelRulesAreV2Shaped && topLevelRules.length > 0;
  const shouldBackfillEnabled = v0EnvironmentsArray.length > 0;
  if (shouldBackfillRulesFromTopLevel || shouldBackfillEnabled) {
    let envSettingsTouched = false;
    for (const envId of ["dev", "production"]) {
      const existing = envSettings[envId];
      if (
        !existing &&
        !shouldBackfillRulesFromTopLevel &&
        !shouldBackfillEnabled
      ) {
        continue;
      }
      const settings = (existing ?? {}) as Partial<FeatureEnvironment> & {
        rules?: V1FeatureRule[];
      };
      if (shouldBackfillRulesFromTopLevel && !("rules" in settings)) {
        settings.rules = topLevelRules as unknown as V1FeatureRule[];
      }
      if (shouldBackfillEnabled && !("enabled" in settings)) {
        settings.enabled = v0EnvironmentsArray.includes(envId);
      }
      envSettings[envId] = settings as FeatureEnvironment;
      envSettingsTouched = true;
    }
    if (envSettingsTouched) {
      postV0Doc.environmentSettings = envSettings;
    }
  }

  if (!topLevelRulesAreV2Shaped) {
    // v1 path. Inheritance must run BEFORE flattening so a rule defined only
    // on a parent env reaches inheriting children — otherwise sparse legacy
    // docs silently lose rules in child envs (origin/main applied inheritance
    // at read time on the per-env shape). Top-level legacy `rules` cruft has
    // already been folded into per-env settings above where applicable.
    //
    // `isPlausibleFeatureRule` filters sparse `null`/`undefined` array slots
    // — Mongoose `Mixed` storage doesn't enforce shape, and pre-v2 docs
    // occasionally landed with corrupt entries that would otherwise crash
    // every downstream `.type`/`.id`/`.environments` access (the
    // "Cannot read properties of undefined (reading 'type')" publish crash).
    // Orphan env IDs are intentionally preserved on the output rules so the
    // UI's `RuleEnvScopeBadges` can render them as struck-through amber pills.
    const inheritedSettings = applyEnvironmentInheritance(orgEnvs, envSettings);
    const rulesByEnv: V1RulesByEnv = {};
    for (const [envId, envObj] of Object.entries(inheritedSettings)) {
      rulesByEnv[envId] = (envObj?.rules || [])
        .filter(isPlausibleFeatureRule)
        .map((r) => {
          const upgraded = upgradeFeatureRule(
            r as FeatureRule,
          ) as V1FeatureRule;
          // Legacy rules occasionally land here without an id; without one
          // `flattenV1ToV2Rules` would skip them. Hash from content so the
          // synthesized id is stable across re-reads and identical-content
          // rules across envs still merge.
          if (!upgraded.id) {
            upgraded.id = synthesizeRuleId(upgraded);
          }
          return upgraded;
        });
    }
    const applicableEnvs = getApplicableEnvIds(orgEnvs, postV0Doc.project);
    const v2 = postV0Doc as unknown as FeatureInterface;
    v2.rules = flattenV1ToV2Rules(rulesByEnv, {
      envOrder: orgEnvs.map((e) => e.id),
      applicableEnvs,
    });
    v2.rules = pinLegacyRolloutSeeds(v2.rules, v2.id);
    v2.environmentSettings = scrubEnvRules(inheritedSettings) as Record<
      string,
      FeatureEnvironment
    >;
    return v2;
  }

  // v2 path. Top-level `rules` is authoritative, but a sparse env that
  // inherits from a parent must also pick up that parent's rule scope —
  // origin/main copied parent's full FeatureEnvironment (rules included)
  // into missing children, so post-unification we expand each rule's
  // `environments` to mirror that. Rules already at allEnvironments=true
  // or scoped to envs whose inheriting children are explicitly defined
  // in environmentSettings are left untouched.
  const v2 = postV0Doc as unknown as FeatureInterface;
  const originalEnvSettings = postV0Doc.environmentSettings || {};
  const inheritedEnvSettings = applyEnvironmentInheritance(
    orgEnvs,
    originalEnvSettings,
  );
  const childrenByAncestor = buildInheritedChildrenByAncestor(
    orgEnvs,
    originalEnvSettings,
  );
  v2.rules = (v2.rules || []).filter(isPlausibleFeatureRule).map((r) => {
    const upgraded = upgradeFeatureRule(r as FeatureRule);
    // Defensive — v2 docs we author always carry ids, but imports and
    // hand-edited backups can land here unstamped.
    if (!upgraded.id) {
      upgraded.id = synthesizeRuleId(upgraded);
    }
    return expandRuleEnvsForInheritance(upgraded, childrenByAncestor);
  });
  v2.rules = pinLegacyRolloutSeeds(v2.rules, v2.id);
  v2.environmentSettings = scrubEnvRules(inheritedEnvSettings) as Record<
    string,
    FeatureEnvironment
  >;
  return v2;
}

// Read-side mirror of `buildFeatureUpdate`'s scrub — keeps in-memory features
// on the v2 `featureEnvironment` shape even when the on-disk doc is legacy.
function scrubEnvRules<T>(envSettings: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [envId, envObj] of Object.entries(envSettings)) {
    if (envObj && typeof envObj === "object" && "rules" in envObj) {
      out[envId] = omit(envObj as Record<string, unknown>, ["rules"]) as T;
    } else {
      out[envId] = envObj;
    }
  }
  return out;
}

// Exported for round-trip integration tests.
export const toInterface = (
  doc: FeatureDocument,
  context: ReqContext | ApiReqContext,
): FeatureInterface => {
  const raw = omit(doc.toJSON<FeatureDocument>(), ["__v", "_id"]);
  return migrateRawFeatureToV2(raw, context);
};

// ---------------------------------------------------------------------------
// Write chokepoint
// ---------------------------------------------------------------------------
// Normalize a feature-write payload to the v2 on-disk shape: strip `rules`
// from each env object, leave everything else alone. Without this scrub, stale
// `env.rules` would cause the next read to mis-classify the doc as v1 and
// re-flatten. Use for all $set payloads on FeatureModel writes.
export function buildFeatureUpdate<
  T extends {
    environmentSettings?: Record<
      string,
      { rules?: unknown; [k: string]: unknown }
    >;
    rules?: unknown;
  },
>(update: T): T {
  let next: T = update;

  if (update.environmentSettings) {
    const scrubbed: Record<string, { [k: string]: unknown }> = {};
    for (const [envId, envObj] of Object.entries(update.environmentSettings)) {
      if (envObj && typeof envObj === "object" && "rules" in envObj) {
        scrubbed[envId] = omit(envObj, ["rules"]);
      } else {
        scrubbed[envId] = envObj;
      }
    }
    next = { ...next, environmentSettings: scrubbed } as T;
  }

  // `allEnvironments: true` is wildcard at runtime; strip any stale
  // `environments` list so the on-disk doc stays consistent with the model.
  // Also drop nullish slots at this write chokepoint so a regression in any
  // upstream filter (autoMerge, normalizeRulesInputToV2, JIT migration) can't
  // re-persist `null`/`undefined` rules to disk and resurrect the
  // "Cannot read properties of undefined (reading 'type')" publish crash.
  if (Array.isArray(next.rules)) {
    const inputRules = next.rules as FeatureRule[];
    const filtered = inputRules.filter(
      (r): r is FeatureRule => r != null && typeof r === "object",
    );
    const normalized = filtered.map((r) => {
      if (r.allEnvironments && Array.isArray(r.environments)) {
        return {
          ...omit(r, ["environments"]),
          allEnvironments: true,
        } as FeatureRule;
      }
      return r;
    });
    const changed =
      filtered.length !== inputRules.length ||
      normalized.some((r, i) => r !== filtered[i]);
    if (changed) next = { ...next, rules: normalized } as T;
  }

  return next;
}

export async function getAllFeatures(
  context: ReqContext | ApiReqContext,
  {
    projects,
    includeArchived = false,
  }: { projects?: string[]; includeArchived?: boolean } = {},
): Promise<FeatureInterface[]> {
  const q: FilterQuery<FeatureDocument> = { organization: context.org.id };
  if (projects && projects.length) {
    Object.assign(q, targetingScopedProjectClause(projects));
  }

  if (!includeArchived) {
    q.archived = { $ne: true };
  }

  const features = (await FeatureModel.find(q)).map((m) =>
    toInterface(m, context),
  );

  return features.filter((feature) =>
    context.permissions.canReadTargetingScopedResource(feature),
  );
}

// Lightweight sibling of {@link getAllFeatures} for whole-collection scans that
// read a feature's behavior (rules, environment settings, values, links) but
// never its editor/authoring fields: the stale-detection/dependents graph and
// the `@const:`/`@config:` reference scanners. Skips Mongoose hydration via
// `.lean()` and projects out the editor fields (they can be large). Same
// migration + permission filter as `getAllFeatures`, so results are otherwise
// interchangeable.
//
// NOTE: the return type is `FeatureInterface[]`, but the projected-out fields
// (`description` / `jsonSchema` / `customFields` / legacy `draft`) will be
// absent at runtime — and so will `legacyDraft`, which the v0 migration
// synthesizes from the projected-out `draft`. Reach for `getAllFeatures` if you
// need a complete feature.
export async function getAllFeaturesWithoutEditorFields(
  context: ReqContext | ApiReqContext,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): Promise<FeatureInterface[]> {
  const q = featureListQuery(context.org.id, { includeArchived });

  const docs = await FeatureModel.find(q, {
    description: 0,
    jsonSchema: 0,
    customFields: 0,
    draft: 0,
  }).lean<LegacyFeatureInterface[]>();

  const features = docs.map((raw) =>
    migrateRawFeatureToV2(
      omit(raw, ["__v", "_id"]) as LegacyFeatureInterface,
      context,
    ),
  );

  // Bulk-publish overlay: substitute the batch's proposed feature states so
  // cross-entity validators evaluate the hypothetical end-state, not live
  // docs. Applied before the permission filter and re-filtered on archived so
  // proposed docs obey the same visibility rules as loaded ones.
  let merged = overlayDocsById(features, context.featureScanOverlay);
  if (merged !== features && !includeArchived) {
    merged = merged.filter((feature) => !feature.archived);
  }

  return merged.filter((feature) =>
    context.permissions.canReadTargetingScopedResource(feature),
  );
}

// Mongo pre-filter mirroring canReadTargetingScopedResource (project,
// targetingProjects, or all-projects flag), so targeting-only features survive.
function targetingScopedProjectClause(
  projects: string[],
): FilterQuery<FeatureDocument> {
  return {
    $or: [
      { project: { $in: projects } },
      { targetingProjects: { $in: projects } },
      { targetingAllProjects: true },
    ],
  };
}

function featureListQuery(
  orgId: string,
  opts: { project?: string; projectIds?: string[]; includeArchived?: boolean },
): FilterQuery<FeatureDocument> {
  const { project, projectIds, includeArchived = false } = opts;
  const scopeClause =
    project != null
      ? targetingScopedProjectClause([project])
      : projectIds != null
        ? targetingScopedProjectClause(projectIds)
        : {};
  return {
    organization: orgId,
    ...scopeClause,
    ...(includeArchived ? {} : { archived: { $ne: true } }),
  };
}

export async function getFeaturesPage(
  context: ReqContext | ApiReqContext,
  {
    project,
    projectIds,
    includeArchived = false,
    limit = 10,
    offset = 0,
  }: {
    project?: string;
    projectIds?: string[];
    includeArchived?: boolean;
    limit?: number;
    offset?: number;
  },
): Promise<FeatureInterface[]> {
  if (projectIds?.length === 0) return [];
  const q = featureListQuery(context.org.id, {
    project,
    projectIds,
    includeArchived,
  });
  const docs = await FeatureModel.find(q)
    .sort({ _id: 1 })
    .skip(offset)
    .limit(limit);
  return docs
    .map((m) => toInterface(m, context))
    .filter((feature) =>
      context.permissions.canReadTargetingScopedResource(feature),
    );
}

export async function countFeatures(
  context: ReqContext | ApiReqContext,
  {
    project,
    projectIds,
    includeArchived = false,
  }: { project?: string; projectIds?: string[]; includeArchived?: boolean },
): Promise<number> {
  if (projectIds?.length === 0) return 0;
  return FeatureModel.countDocuments(
    featureListQuery(context.org.id, { project, projectIds, includeArchived }),
  );
}

export async function hasArchivedFeatures(
  context: ReqContext | ApiReqContext,
  project?: string,
): Promise<boolean> {
  const q: FilterQuery<FeatureDocument> = {
    organization: context.org.id,
    archived: true,
  };
  if (project) {
    q.project = project;
  }

  const f = await FeatureModel.findOne(q);
  return !!f;
}

export async function getFeature(
  context: ReqContext | ApiReqContext,
  id: string,
): Promise<FeatureInterface | null> {
  const feature = await FeatureModel.findOne({
    organization: context.org.id,
    id,
  });
  if (!feature) return null;

  return context.permissions.canReadTargetingScopedResource(feature)
    ? toInterface(feature, context)
    : null;
}

export async function migrateDraft(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
) {
  if (!feature.legacyDraft || feature.legacyDraftMigrated) return null;

  try {
    const draft = await createRevisionFromLegacyDraft(context, feature);
    await FeatureModel.updateOne(
      {
        organization: feature.organization,
        id: feature.id,
      },
      {
        $set: {
          legacyDraftMigrated: true,
        },
      },
    );
    return draft;
  } catch (e) {
    logger.error(e, "Error migrating old feature draft");
  }
  return null;
}

export async function getFeaturesByIds(
  context: ReqContext | ApiReqContext,
  ids: string[],
): Promise<FeatureInterface[]> {
  if (!ids.length) return [];
  const features = (
    await FeatureModel.find({ organization: context.org.id, id: { $in: ids } })
  ).map((m) => toInterface(m, context));

  return features.filter((feature) =>
    context.permissions.canReadTargetingScopedResource(feature),
  );
}

// Returns id -> project for every feature that exists in the org, regardless of
// the caller's read permission. Intended for permission decisions where missing
// (inaccessible) and non-existent features must be distinguished — do not use it
// to return feature data to the caller.
export async function getFeatureProjectsByIds(
  context: ReqContext | ApiReqContext,
  ids: string[],
): Promise<Map<string, string | undefined>> {
  if (!ids.length) return new Map();
  const features = await FeatureModel.find(
    { organization: context.org.id, id: { $in: ids } },
    { id: 1, project: 1, _id: 0 },
  );
  return new Map(features.map((f) => [f.id, f.project || undefined]));
}

/**
 * The environments each named rule CURRENTLY serves, keyed `featureId:ruleId`.
 *
 * The ramp control gate needs it because a patch naming `environments` REPLACES
 * that field on the rule — so narrowing production→dev stops serving production,
 * and a footprint read from the patch alone never mentions it. Raw fetch, like
 * `getFeatureProjectsByIds`: a target the caller cannot read is precisely the one
 * that must still be checked, and a rule that is gone contributes "all" — the
 * strictest answer available.
 */
export async function getFeatureRuleEnvironmentsByIds(
  context: ReqContext | ApiReqContext,
  refs: { featureId: string; ruleId?: string; environment?: string }[],
): Promise<Map<string, string[] | "all">> {
  const result = new Map<string, string[] | "all">();
  const named = refs.filter((r) => !!r.ruleId);
  if (!named.length) return result;

  const features = await FeatureModel.find(
    {
      organization: context.org.id,
      id: { $in: [...new Set(named.map((r) => r.featureId))] },
    },
    { id: 1, rules: 1, environmentSettings: 1, _id: 0 },
  );
  const byId = new Map(features.map((f) => [f.id, toInterface(f, context)]));

  for (const { featureId, ruleId, environment } of named) {
    // The key must carry `environment`, because the RESOLUTION does. Two targets
    // sharing a `ruleId` but naming different environments — the shape
    // `flattenV1ToV2Rules` produces for a migrated feature — collided on
    // `featureId:ruleId`, and the last one written won. A dev target could therefore
    // overwrite a production target's answer, and the gate read ["dev"] for both
    // while the executor resolved the production sibling and rescoped it. Unioning
    // per rule id could not fix it: both refs agree on the id and differ only here.
    const key = rampRuleEnvKey(featureId, ruleId, environment);
    const feature = byId.get(featureId);
    // EVERY sibling the execution path will patch, resolved the way it resolves
    // them — `resolveRampTargets`, honouring `environment`. Taking the first stem
    // match read whichever rule came first: with siblings `fr_x__dev` (["dev"]) and
    // `fr_x` (["dev","production"]), the dev sibling gave a ["dev"] footprint while
    // the write rescoped `fr_x` out of production. flattenRules states the rule
    // explicitly: execution paths must iterate every match.
    const matches = resolveRampTargets(
      { ruleId, environment },
      feature?.rules ?? [],
    );
    if (!matches.length) {
      // Unresolvable: assume the widest reach rather than none.
      result.set(key, "all");
      continue;
    }
    if (matches.some((r) => r.allEnvironments)) {
      result.set(key, "all");
      continue;
    }
    const envs = new Set<string>();
    for (const rule of matches) {
      for (const env of rule.environments ?? []) envs.add(env);
    }
    result.set(key, [...envs]);
  }
  return result;
}

export async function createFeature(
  context: ReqContext | ApiReqContext,
  data: FeatureInterface,
) {
  const { org } = context;

  const linkedExperiments = getLinkedExperiments(data);

  const featureToCreate = buildFeatureUpdate({
    ...data,
    linkedExperiments,
  });

  if (Array.isArray(featureToCreate.rules)) {
    const { rules: dedupedRules, collisions } = ensureUniqueRuleIds(
      featureToCreate.rules as FeatureRule[],
    );
    if (collisions.length > 0) {
      logger.warn(
        { featureId: data.id, collisions },
        "Duplicate rule ids auto-suffixed on feature create",
      );
      featureToCreate.rules = dedupedRules;
    }
  }

  // A config-backed feature's default AND rule values must conform to the
  // backing config's effective schema. Enforced at this shared create choke
  // point so every entry point is covered — not just the v2 REST handlers.
  // Legacy/internal create paths (v1 POST, internal postFeatures) reach here
  // without their own net, and creation writes a published revision directly
  // (no publish-time re-check), so an unchecked create would ship a
  // schema-violating value on version 1. The flat top-level `rules` is canonical
  // here: callers populate it (buildFeatureUpdate then strips the legacy
  // env-settings copies), so it holds every rule regardless of entry point.
  // No-op for non-json / non-config features and when skipSchemaValidation is set.
  await assertConfigBackedFeatureValuesValid(context, featureToCreate, {
    defaultValue: featureToCreate.defaultValue,
    rules: featureToCreate.rules as FeatureRule[] | undefined,
  });

  // Run any custom hooks for this feature
  await runValidateFeatureHooks({
    context,
    feature: featureToCreate,
    original: null,
  });

  const feature = await FeatureModel.create(featureToCreate);

  // Historically, we haven't properly removed revisions when deleting a feature
  // So, clean up any conflicting revisions first before creating a new one
  await deleteAllRevisionsForFeature(org.id, feature.id);

  await createInitialRevision(
    context,
    toInterface(feature, context),
    context.auditUser,
    getEnvironmentIdsFromOrg(org),
  );

  if (linkedExperiments.length > 0) {
    await Promise.all(
      linkedExperiments.map(async (exp) => {
        await addLinkedFeatureToExperiment(context, exp, data.id);
      }),
    );
  }

  onFeatureCreate(context, toInterface(feature, context)).catch((e) => {
    logger.error(e, "Error refreshing SDK Payload on feature create");
  });
}

export async function deleteFeature(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
) {
  await FeatureModel.deleteOne({
    organization: context.org.id,
    id: feature.id,
  });
  await deleteAllRevisionsForFeature(context.org.id, feature.id);
  await context.models.featureRevisionLogs.deleteAllByFeature(feature);

  if (feature.linkedExperiments) {
    await Promise.all(
      feature.linkedExperiments.map(async (exp) => {
        await removeLinkedFeatureFromExperiment(context, exp, feature.id);
      }),
    );
  }
  // The SDK refresh fires BEFORE the bandit-linkage cleanup: the flag is
  // already gone from the store, and a linkage failure below must not strand it
  // in served payloads. Linkage repair is retryable bookkeeping; a payload
  // serving a deleted flag is an incident.
  onFeatureDelete(context, feature).catch((e) => {
    logger.error(e, "Error refreshing SDK Payload on feature delete");
  });
  const contextualBanditLinkagePlan = await planFeatureContextualBanditLinkage(
    context,
    feature.id,
    [],
    [],
  );
  if (contextualBanditLinkagePlan) {
    await applyFeatureContextualBanditLinkage(
      context,
      contextualBanditLinkagePlan,
    );
  }
}

/**
 * Deletes all features belonging to a project
 * @param projectId
 * @param organization
 */
export async function projectHasFeatures(
  context: ReqContext | ApiReqContext,
  projectId: string,
): Promise<boolean> {
  return !!(await FeatureModel.exists({
    organization: context.org.id,
    project: projectId,
  }));
}

export async function deleteAllFeaturesForAProject({
  projectId,
  context,
}: {
  projectId: string;
  context: ReqContext | ApiReqContext;
}) {
  const featuresToDelete = await FeatureModel.find({
    organization: context.org.id,
    project: projectId,
  });

  for (const feature of featuresToDelete) {
    await deleteFeature(context, toInterface(feature, context));
  }
}

export const createFeatureEvent = async <
  Event extends ResourceEvents<"feature">,
>(eventData: {
  context: ReqContext;
  event: Event;
  data: CreateEventData<"feature", Event, FeatureInterface>;
}) => {
  const event: CreateEventParams<"feature", Event> = await (async () => {
    const groupMap = await getSavedGroupMap(eventData.context);
    const experimentMap = await getExperimentMapForFeature(
      eventData.context,
      eventData.data.object.id,
    );

    const currentRevision = await getRevision({
      context: eventData.context,
      organization: eventData.data.object.organization,
      featureId: eventData.data.object.id,
      feature: eventData.data.object,
      version: eventData.data.object.version,
    });

    const safeRolloutMap =
      await eventData.context.models.safeRollout.getAllPayloadSafeRollouts();

    // Resolve targetingAllProjects into concrete ids so webhooks route by delivery scope.
    const allProjectIds = await eventData.context.getAllProjectIds();

    const currentApiFeature = getApiFeatureObj({
      feature: eventData.data.object,
      organization: eventData.context.org,
      groupMap,
      experimentMap,
      revision: currentRevision,
      safeRolloutMap,
    });

    if (!hasPreviousObject<"feature", Event, FeatureInterface>(eventData.data))
      return {
        ...eventData,
        object: "feature",
        data: {
          object: currentApiFeature,
        },
        projects: resolveTargetingProjectIds(currentApiFeature, allProjectIds),
        tags: currentApiFeature.tags,
        environments: deriveLiveFeatureEventEnvironments({
          current: currentApiFeature,
          deleted: eventData.event === "deleted",
        }),
        containsSecrets: false,
      } as CreateEventParams<"feature", Event>;

    const previousRevision = await getRevision({
      context: eventData.context,
      organization: eventData.data.previous_object.organization,
      featureId: eventData.data.previous_object.id,
      feature: eventData.data.previous_object,
      version: eventData.data.previous_object.version,
    });

    const previousApiFeature = getApiFeatureObj({
      feature: eventData.data.previous_object,
      organization: eventData.context.org,
      groupMap,
      experimentMap,
      revision: previousRevision,
      safeRolloutMap,
    });

    let changes: DiffResult | undefined;
    try {
      changes = getObjectDiff(previousApiFeature, currentApiFeature, {
        ignoredKeys: ["dateUpdated", "date"],
        nestedObjectConfigs: [
          {
            key: "environments",
            idField: "id",
            ignoredKeys: ["definition", "savedGroups"],
            arrayField: "rules",
          },
        ],
      });
    } catch (e) {
      logger.error(e, "error creating change patch");
    }

    return {
      ...eventData,
      object: "feature",
      objectId: eventData.data.object.id,
      data: {
        object: currentApiFeature,
        previous_object: previousApiFeature,
        changes,
      },
      projects: Array.from(
        new Set([
          ...resolveTargetingProjectIds(previousApiFeature, allProjectIds),
          ...resolveTargetingProjectIds(currentApiFeature, allProjectIds),
        ]),
      ),
      tags: Array.from(
        new Set([...previousApiFeature.tags, ...currentApiFeature.tags]),
      ),
      environments: deriveLiveFeatureEventEnvironments({
        previous: previousApiFeature,
        current: currentApiFeature,
      }),
      containsSecrets: false,
    } as CreateEventParams<"feature", Event>;
  })();

  await createEvent<"feature", Event>(event);
};

/**
 * Given the common {@link FeatureInterface} for both previous and next states, and the organization,
 * will log an update event in the events collection
 * @param organization
 * @param previous
 * @param current
 */
export const logFeatureUpdatedEvent = async (
  context: ReqContext | ApiReqContext,
  previous: FeatureInterface,
  current: FeatureInterface,
) =>
  createFeatureEvent({
    context,
    event: "updated",
    data: {
      object: current,
      previous_object: previous,
    },
  });

/**
 * @param organization
 * @param feature
 * @returns event.id
 */
export const logFeatureCreatedEvent = async (
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
) =>
  createFeatureEvent({
    context,
    event: "created",
    data: {
      object: feature,
    },
  });

/**
 * @param organization
 * @param previousFeature
 */
export const logFeatureDeletedEvent = async (
  context: ReqContext | ApiReqContext,
  previousFeature: FeatureInterface,
) =>
  createFeatureEvent({
    context,
    event: "deleted",
    data: {
      object: previousFeature,
    },
  });

async function onFeatureCreate(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
) {
  const allProjectIds = await context.getAllProjectIds();
  queueSDKPayloadRefresh({
    context,
    payloadKeys: getAffectedSDKPayloadKeys(
      [feature],
      getEnvironmentIdsFromOrg(context.org),
      undefined,
      allProjectIds,
    ),
    auditContext: {
      event: "created",
      model: "feature",
      id: feature.id,
    },
  });

  await logFeatureCreatedEvent(context, feature);

  if (context.org.isVercelIntegration)
    await createVercelExperimentationItemFromFeature({
      feature,
      organization: context.org,
    });
}

async function onFeatureDelete(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
) {
  const allProjectIds = await context.getAllProjectIds();
  queueSDKPayloadRefresh({
    context,
    payloadKeys: getAffectedSDKPayloadKeys(
      [feature],
      getEnvironmentIdsFromOrg(context.org),
      undefined,
      allProjectIds,
    ),
    auditContext: {
      event: "deleted",
      model: "feature",
      id: feature.id,
    },
  });

  await logFeatureDeletedEvent(context, feature);

  if (context.org.isVercelIntegration)
    await deleteVercelExperimentationItemFromFeature({
      feature,
      organization: context.org,
    });
}

export async function onFeatureUpdate(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  updatedFeature: FeatureInterface,
  skipRefreshForProject?: string,
) {
  // BEFORE the first await. This function is invoked fire-and-forget and suspends on
  // `getAllProjectIds` — a real round trip on a cold cache, which is exactly the first
  // iteration of a loop that publishes several features in turn. By the time it
  // resumes, the next landing may have opened its own buffer, and reading the context
  // then attributes this write to that landing.
  const buffer = captureEventBuffer(context);
  const allProjectIds = await context.getAllProjectIds();
  queueSDKPayloadRefresh({
    context,
    payloadKeys: getSDKPayloadKeysByDiff(
      feature,
      updatedFeature,
      getEnvironmentIdsFromOrg(context.org),
      allProjectIds,
    ),
    skipRefreshForProject,
    auditContext: {
      event: "updated",
      model: "feature",
      id: feature.id,
    },
  });

  // Don't fire webhooks if only `dateUpdated` changes (ex: creating/modifying a unpublished draft)
  if (
    !isEqual(
      omit(feature, ["dateUpdated"]),
      omit(updatedFeature, ["dateUpdated"]),
    )
  ) {
    // Event-based webhooks. During a bulk-publish commit the emission defers
    // to the post-commit flush (dropped entirely if the commit compensates).
    await emitOrDeferBulkPublishEvent(
      () => logFeatureUpdatedEvent(context, feature, updatedFeature),
      entityKey("feature", feature.id),
      buffer,
    );
  }

  if (context.org.isVercelIntegration)
    await updateVercelExperimentationItemFromFeature({
      feature: updatedFeature,
      organization: context.org,
    });
}

export async function updateFeature(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  updates: Partial<FeatureInterface>,
  options?: {
    // A compare-and-swap, degenerate: one guard field, no compute callback, no
    // retry. Conditions the write on the doc still carrying this `dateUpdated` and
    // throws `CasConflictError` when it doesn't — the feature twin of
    // `updateIfUnchanged` on BaseModel, and named for the mechanism because the
    // previous name hid it from a change that swept every other CAS site.
    // Landings pass the pre-image's stamp; compensation and cascade writes stay
    // unguarded because they re-read first and mean to write over what they found.
    casOnDateUpdated?: Date;
    // Remove the holdout pointer in the SAME write. `updates` is a $set, and a
    // landing that removes the holdout must not split into two writes — the gap
    // between them is a window where a rival publish can land and be overwritten.
    unsetHoldout?: boolean;
    // The stamp this write PUTS on the document, reported as it is computed.
    //
    // Fires only after Mongo confirms the write, so it means "this landed", never
    // "this was attempted".
    //
    // Compensation uses it as the ownership token, and the returned doc is a
    // set-then-fetch — so a rival landing between the write and the re-read makes
    // the returned `dateUpdated` THEIRS. Reading ownership from that says "still
    // ours" at the exact moment it isn't, and the unguarded satellite rewinds then
    // reverse the rival's holdout, experiment and bandit linkage.
    onStamped?: (stamp: Date) => void;
  },
): Promise<FeatureInterface> {
  const ourStamp = advancedGuardStamp(options?.casOnDateUpdated);
  const allUpdates = {
    ...updates,
    // Strictly after the guarded token, even inside the same millisecond.
    dateUpdated: ourStamp,
  };
  // Used only for hooks and linkedExperiment derivation; the post-write
  // value is re-read from Mongo below. The holdout $unset is modeled here so
  // callers can pass the TRUE pre-image — handing hooks a doc with the holdout
  // pre-stripped hid a holdout-only change from diffing and events.
  const projected = {
    ...feature,
    ...allUpdates,
  };
  if (options?.unsetHoldout) delete projected.holdout;

  // Refresh linkedExperiments if needed
  const linkedExperiments = getLinkedExperiments(projected);
  const experimentsAdded = new Set<string>();
  if (!isEqual(linkedExperiments, feature.linkedExperiments)) {
    allUpdates.linkedExperiments = linkedExperiments;
    projected.linkedExperiments = linkedExperiments;

    // New experiments this feature was added to
    linkedExperiments.forEach((exp) => {
      if (!feature.linkedExperiments?.includes(exp)) {
        experimentsAdded.add(exp);
      }
    });
  }

  // While a bulk-publish commit is applying, validation hooks already ran as
  // plan gates against the release end-state; re-running them here would judge
  // the mid-commit mix — and would veto compensation restores. Gated on
  // `bulkPublishApplying` (not the correlation token) so genuine post-commit
  // writes — ramp activation etc., NOT covered by the plan gates — still run.
  if (!context.bulkPublishApplying) {
    await runValidateFeatureHooks({
      context,
      feature: projected,
      original: feature,
    });
  }

  // Hygiene: when persisting a new top-level v2 `rules` array, also force-scrub
  // any legacy `environmentSettings.{env}.rules` from the doc. The JIT read
  // migration trusts top-level v2 rules over env.rules now (so this is no
  // longer load-bearing for correctness), but leaving the legacy key around
  // bloats the doc, confuses direct-mongo readers, and would re-introduce the
  // shadow if the JIT routing ever regressed. Inject a scrubbed
  // `environmentSettings` payload so `buildFeatureUpdate`'s scrub path
  // overwrites them.
  if (
    Array.isArray(allUpdates.rules) &&
    allUpdates.environmentSettings === undefined &&
    feature.environmentSettings
  ) {
    allUpdates.environmentSettings = { ...feature.environmentSettings };
  }

  const normalizedUpdates = buildFeatureUpdate(allUpdates);

  if (Array.isArray(normalizedUpdates.rules)) {
    const { rules: dedupedRules, collisions } = ensureUniqueRuleIds(
      normalizedUpdates.rules as FeatureRule[],
    );
    if (collisions.length > 0) {
      logger.warn(
        { featureId: feature.id, collisions },
        "Duplicate rule ids auto-suffixed on feature update",
      );
      normalizedUpdates.rules = dedupedRules;
    }
  }

  const writeResult = await FeatureModel.updateOne(
    {
      organization: feature.organization,
      id: feature.id,
      ...(options?.casOnDateUpdated
        ? { dateUpdated: options.casOnDateUpdated }
        : {}),
    },
    {
      $set: normalizedUpdates,
      ...(options?.unsetHoldout ? { $unset: { holdout: "" } } : {}),
    },
  );
  if (options?.casOnDateUpdated && writeResult.matchedCount === 0) {
    throw new CasConflictError();
  }

  // Reported only once Mongo has CONFIRMED the write. Reporting it alongside the
  // computation claimed ownership for a write that might never land: a CAS loser
  // then looked like it owned a stamp live had never carried, its caller read that
  // as "a rival took the feature", and every rewind was skipped — including the
  // ramp schedules created before the write, which leaked.
  options?.onStamped?.(ourStamp);

  if (experimentsAdded.size > 0) {
    await Promise.all(
      [...experimentsAdded].map(async (exp) => {
        await addLinkedFeatureToExperiment(context, exp, feature.id);
      }),
    );
  }

  // Set-then-fetch: the persisted doc flows through the same JIT pipeline as
  // any other read, so audit/SDK/response all see identical state.
  const persisted = await FeatureModel.findOne({
    organization: feature.organization,
    id: feature.id,
  });
  const updatedFeature = persisted
    ? toInterface(persisted, context)
    : projected;

  onFeatureUpdate(context, feature, updatedFeature).catch((e) => {
    logger.error(e, "Error refreshing SDK Payload on feature update");
  });

  return updatedFeature;
}

// Targeted write for the scheduled-features cron; skips onFeatureUpdate so
// this system-driven change doesn't generate an audit event.
export async function updateNextScheduledDate(
  feature: FeatureInterface,
  nextScheduledUpdate: Date | null,
): Promise<FeatureInterface> {
  const dateUpdated = new Date();
  await FeatureModel.updateOne(
    { organization: feature.organization, id: feature.id },
    { $set: { nextScheduledUpdate, dateUpdated } },
  );
  return {
    ...feature,
    nextScheduledUpdate: nextScheduledUpdate ?? undefined,
    dateUpdated,
  };
}

export async function addLinkedExperiment(
  feature: FeatureInterface,
  experimentId: string,
) {
  if (feature.linkedExperiments?.includes(experimentId)) return;

  await FeatureModel.updateOne(
    { organization: feature.organization, id: feature.id },
    {
      $addToSet: {
        linkedExperiments: experimentId,
      },
    },
  );
}

export async function getScheduledFeaturesToUpdate() {
  const features = await FeatureModel.find({
    nextScheduledUpdate: {
      $exists: true,
      $ne: null,
      $lt: new Date(),
    },
  });
  const orgIds = Array.from(new Set(features.map((f) => f.organization)));
  const jobContextsByOrg: Record<string, ApiReqContext> = {};
  await Promise.all(
    orgIds.map(async (orgId) => {
      jobContextsByOrg[orgId] = await getContextForAgendaJobByOrgId(orgId);
    }),
  );
  return features.map((m) => toInterface(m, jobContextsByOrg[m.organization]));
}

export async function archiveFeature(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  isArchived: boolean,
) {
  const updated = await updateFeature(context, feature, {
    archived: isArchived,
  });
  // Cancel pending schedules so an archived feature can't auto-publish a draft.
  if (isArchived) {
    await cancelScheduledPublishesForFeature(
      context,
      context.org.id,
      feature.id,
    );
  }
  return updated;
}

function setEnvironmentSettings(
  feature: FeatureInterface,
  environment: string,
  settings: Partial<FeatureEnvironment>,
) {
  const updatedFeature = cloneDeep(feature);

  updatedFeature.environmentSettings = updatedFeature.environmentSettings || {};
  // Don't seed `rules: []` — v2 envSettings only carry enabled/prerequisites.
  updatedFeature.environmentSettings[environment] = updatedFeature
    .environmentSettings[environment] || { enabled: false };

  updatedFeature.environmentSettings[environment] = {
    ...updatedFeature.environmentSettings[environment],
    ...settings,
  };

  return updatedFeature;
}

export async function toggleMultipleEnvironments(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  toggles: Record<string, boolean>,
) {
  const validEnvs = new Set(getEnvironmentIdsFromOrg(context.org));

  let featureCopy = cloneDeep(feature);
  let hasChanges = false;
  Object.keys(toggles).forEach((env) => {
    if (!validEnvs.has(env)) {
      throw new Error("Invalid environment: " + env);
    }
    const state = toggles[env];
    const currentState = feature.environmentSettings?.[env]?.enabled ?? false;
    if (currentState !== state) {
      hasChanges = true;
      featureCopy = setEnvironmentSettings(featureCopy, env, {
        enabled: state,
      });
    }
  });

  // If there are changes we need to apply
  if (hasChanges) {
    const updatedFeature = await updateFeature(context, feature, {
      environmentSettings: featureCopy.environmentSettings,
    });

    return updatedFeature;
  }

  return featureCopy;
}

export async function toggleFeatureEnvironment(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  environment: string,
  state: boolean,
) {
  return await toggleMultipleEnvironments(context, feature, {
    [environment]: state,
  });
}

/**
 * Append a rule to `revision.rules`. `envs === undefined` or an `envs` list
 * covering every applicable env collapses to `allEnvironments: true`.
 */
export async function addFeatureRule(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  envs: string[] | undefined,
  rule: FeatureRule,
  user: EventUser,
  resetReview: boolean,
) {
  addIdsToFlatRules([rule], feature.id);

  const applicableEnvs = getEnvironmentIdsFromOrg(context.org);
  const isAllEnvs =
    !envs || envs.length === 0 || applicableEnvs.every((e) => envs.includes(e));

  const scopedRule: FeatureRule = isAllEnvs
    ? ({ ...rule, allEnvironments: true } as FeatureRule)
    : ({
        ...rule,
        allEnvironments: false,
        environments: [...envs!],
      } as FeatureRule);

  const nextRules: FeatureRule[] = [...(revision.rules ?? []), scopedRule];

  await updateRevision(
    context,
    feature,
    revision,
    { rules: nextRules },
    {
      user,
      action: "add rule",
      subject: isAllEnvs ? "to all environments" : `to ${envs!.join(", ")}`,
      value: JSON.stringify(scopedRule),
    },
    resetReview,
  );
}

// Edit a single rule by `ruleId`. `auditEnvironment` is only used for the
// audit log subject. See `editFeatureRules` for the batch form.
export async function editFeatureRule(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  ruleId: string,
  updates: Partial<FeatureRule>,
  user: EventUser,
  resetReview: boolean,
  auditEnvironment?: string,
) {
  return await editFeatureRules(
    context,
    feature,
    revision,
    [{ ruleId, environmentId: auditEnvironment }],
    updates,
    user,
    resetReview,
  );
}

/**
 * Batch edit rules matched by `ruleId`. `environmentId` is used only for the
 * audit log subject; matching is by id alone. Duplicate ids collapse to a
 * single overlay (idempotent).
 */
export async function editFeatureRules(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  matches: { ruleId: string; environmentId?: string }[],
  updates: Partial<FeatureRule>,
  user: EventUser,
  resetReview: boolean,
) {
  const projected = applyPartialFeatureRuleUpdatesToRevision(
    revision,
    matches.map((m) => m.ruleId),
    updates,
  );

  // Audit subject uses caller-supplied envs (the user's tab context), not
  // the rule's underlying scope.
  const envs = Array.from(
    new Set(
      matches.map((m) => m.environmentId).filter((e): e is string => !!e),
    ),
  );
  const subject =
    envs.length === 0
      ? `rule ${matches[0]?.ruleId ?? ""}`
      : envs.length === 1
        ? `in ${envs[0]}`
        : `in ${envs.join(", ")}`;

  const updatedRevision = await updateRevision(
    context,
    feature,
    revision,
    { rules: projected.rules ?? [] },
    {
      user,
      action: "edit rule",
      subject,
      value: JSON.stringify(updates),
    },
    resetReview,
  );
  return updatedRevision;
}

export async function removeTagInFeature(
  context: ReqContext | ApiReqContext,
  tag: string,
) {
  const query = { organization: context.org.id, tags: tag };

  const featureDocs = await FeatureModel.find(query);
  const features = (featureDocs || []).map((m) => toInterface(m, context));

  await FeatureModel.updateMany(query, {
    $pull: { tags: tag },
  });

  features.forEach((feature) => {
    const updatedFeature = {
      ...feature,
      tags: (feature.tags || []).filter((t) => t !== tag),
    };

    onFeatureUpdate(context, feature, updatedFeature).catch((e) => {
      logger.error(e, "Error refreshing SDK Payload on feature update");
    });
  });
}

export async function removeHoldoutFromFeature(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
) {
  if (!feature.holdout) return;
  await FeatureModel.updateOne(
    { organization: context.org.id, id: feature.id },
    { $unset: { holdout: "" } },
  );
}

export async function removeProjectFromFeatures(
  context: ReqContext | ApiReqContext,
  project: string,
) {
  const query = { organization: context.org.id, project };

  const featureDocs = await FeatureModel.find(query);
  const features = (featureDocs || []).map((m) => toInterface(m, context));

  await FeatureModel.updateMany(query, { $set: { project: "" } });

  features.forEach((feature) => {
    const updatedFeature = {
      ...feature,
      project: "",
    };

    onFeatureUpdate(context, feature, updatedFeature, project).catch((e) => {
      logger.error(e, "Error refreshing SDK Payload on feature update");
    });
  });

  // Also drop the deleted project from any feature's secondary targeting list.
  const targetingQuery = {
    organization: context.org.id,
    targetingProjects: project,
  };
  const targetingDocs = await FeatureModel.find(targetingQuery);
  const targetingFeatures = (targetingDocs || []).map((m) =>
    toInterface(m, context),
  );

  await FeatureModel.updateMany(targetingQuery, {
    $pull: { targetingProjects: project },
  });

  targetingFeatures.forEach((feature) => {
    const updatedFeature = {
      ...feature,
      targetingProjects: (feature.targetingProjects ?? []).filter(
        (p) => p !== project,
      ),
    };

    onFeatureUpdate(context, feature, updatedFeature, project).catch((e) => {
      logger.error(e, "Error refreshing SDK Payload on feature update");
    });
  });

  // Also drop the deleted project from any rule-level scope. [deletedProject] → []
  // (leak-safe: never "all"; allProjects stays false). Per-doc: rules is Mixed.
  const ruleScopeQuery = {
    organization: context.org.id,
    "rules.projects": project,
  };
  const ruleScopedDocs = await FeatureModel.find(ruleScopeQuery);
  for (const doc of ruleScopedDocs || []) {
    const feature = toInterface(doc, context);
    const updatedRules = (feature.rules ?? []).map((rule) =>
      rule && Array.isArray(rule.projects) && rule.projects.includes(project)
        ? { ...rule, projects: rule.projects.filter((p) => p !== project) }
        : rule,
    );
    await FeatureModel.updateOne(
      { organization: context.org.id, id: feature.id },
      { $set: { rules: updatedRules } },
    );

    const updatedFeature = { ...feature, rules: updatedRules };
    onFeatureUpdate(context, feature, updatedFeature, project).catch((e) => {
      logger.error(e, "Error refreshing SDK Payload on feature update");
    });
  }
}

export async function setDefaultValue(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  defaultValue: string,
  user: EventUser,
  requireReview: boolean,
) {
  // Fail early on the internal draft-edit path (the REST default-value endpoint
  // enforces the same lock at its handler); publish re-checks regardless.
  assertConfigBackedDefaultHasNoOverrides(feature, defaultValue);

  return updateRevision(
    context,
    feature,
    revision,
    { defaultValue },
    {
      user,
      action: "edit default value",
      subject: ``,
      value: JSON.stringify({ defaultValue }),
    },
    requireReview,
  );
}

export async function setJsonSchema(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  def: Omit<JSONSchemaDef, "date">,
) {
  // Validate Simple Schema (sanity check)
  if (def.schemaType === "simple" && def.simple) {
    simpleSchemaValidator.parse(def.simple);
  }

  return await updateFeature(context, feature, {
    jsonSchema: { ...def, date: new Date() },
  });
}

// The status the publish-time sync will write per safe rollout: the revision
// rule's status, plus "stopped" for live safe-rollout rules the revision
// removes; empty when the revision carries no rules. Exported so the bulk
// publisher's compensation snapshots predict exactly what
// updateSafeRolloutStatuses writes.
export function computeSafeRolloutStatusMap(
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
): Record<string, "running" | "rolled-back" | "released" | "stopped"> {
  if (!revision.rules || revision.rules.length === 0) return {};
  const map: Record<
    string,
    "running" | "rolled-back" | "released" | "stopped"
  > = Object.fromEntries(
    revision.rules
      .filter((rule): rule is SafeRolloutRule => rule?.type === "safe-rollout")
      .map((rule) => [rule.safeRolloutId, rule.status]),
  );
  // Stop safe rollouts whose rule was removed in this revision.
  for (const rule of feature.rules ?? []) {
    if (rule?.type === "safe-rollout" && !map[rule.safeRolloutId]) {
      map[rule.safeRolloutId] = "stopped";
    }
  }
  return map;
}

const updateSafeRolloutStatuses = async (
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
) => {
  const statusMap = computeSafeRolloutStatusMap(feature, revision);
  const ids = Object.keys(statusMap);
  if (!ids.length) return;

  const safeRollouts = await context.models.safeRollout.getByIds(ids);

  // SEQUENTIAL, with a rewind list. Under `Promise.all` one rollout could start
  // while another failed, and the caller's compensation restores only the feature
  // document — leaving a started rollout attached to a revision that never
  // published. One at a time makes the set that landed knowable; the counts here
  // are a handful per feature, so nothing is lost by not overlapping them.
  const applied: {
    before: SafeRolloutInterface;
    written: UpdateProps<SafeRolloutInterface>;
  }[] = [];

  try {
    for (const safeRollout of safeRollouts) {
      // sync the status of the safe rollout to the status of the revision
      const safeRolloutUpdates: UpdateProps<SafeRolloutInterface> = {
        status: statusMap[safeRollout.id],
      };
      if (!safeRollout.startedAt && safeRolloutUpdates.status === "running") {
        safeRolloutUpdates["startedAt"] = new Date();
        const { nextSnapshot, nextRampUp } =
          determineNextSafeRolloutSnapshotAttempt(safeRollout, context.org);
        safeRolloutUpdates["nextSnapshotAttempt"] = nextSnapshot;
        safeRolloutUpdates["rampUpSchedule"] = {
          ...safeRollout.rampUpSchedule,
          nextUpdate: nextRampUp,
        };
      }

      await context.models.safeRollout.update(safeRollout, safeRolloutUpdates);
      applied.push({ before: safeRollout, written: safeRolloutUpdates });
    }
  } catch (e) {
    // Value-checked, the same rule every other compensation here follows: put a
    // key back only while live still holds what THIS sync wrote, so a concurrent
    // writer's newer value survives. Reversed order, innermost first.
    for (const { before, written } of applied.reverse()) {
      try {
        const current = await context.models.safeRollout.getById(before.id);
        if (!current) continue;
        const restore = ownedRestoreValues({
          keys: Object.keys(written),
          preImage: before as unknown as Record<string, unknown>,
          written: written as Record<string, unknown>,
          current: current as unknown as Record<string, unknown>,
        });
        if (Object.keys(restore).length) {
          // GUARDED on the document ownership was read from — deriving the restore
          // and then issuing a plain update is check-then-act, and a worker
          // advancing this rollout in between would be overwritten by our pre-image.
          // A lost race means they own it now, which is the same answer
          // `ownedRestoreValues` gives for a key it can no longer claim.
          // A lost race means the failed publish's values are STILL LIVE on this
          // rollout, so it is a reversal failure like any other — swallowing it
          // reported a clean rollback over state that never came back.
          await context.models.safeRollout.updateIfUnchanged(
            current,
            restore as UpdateProps<SafeRolloutInterface>,
          );
        }
      } catch (undoErr) {
        logger.error(
          undoErr,
          `Safe-rollout sync failed for feature ${feature.id} and rollout ${before.id} could not be put back; it is left advanced while its revision is unpublished`,
        );
      }
    }
    throw e;
  }
};

// Pure computation of the feature-doc changes a revision merge will produce; no writes
export function computeRevisionMergeChanges(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  result: MergeResultChanges,
): {
  changes: Partial<FeatureInterface>;
  hasChanges: boolean;
  removeHoldout: boolean;
} {
  let hasChanges = false;
  const changes: Partial<FeatureInterface> = {};
  let removeHoldout = false;

  if (result.defaultValue !== undefined) {
    changes.defaultValue = result.defaultValue;
    hasChanges = true;
  }

  if (result.rules !== undefined) {
    changes.rules = result.rules;
    // Stamp seeds/ids on new rules being published. Legacy rules were pinned on
    // read, so this never re-seeds (and re-buckets) an existing rollout.
    addIdsToFlatRules(changes.rules, feature.id);
    hasChanges = true;
  }

  if (result.environmentsEnabled) {
    const envs = getEnvironmentIdsFromOrg(context.org);
    const nextEnvSettings = cloneDeep(feature.environmentSettings || {});
    let envChanged = false;
    envs.forEach((env) => {
      const desired = result.environmentsEnabled?.[env];
      if (desired === undefined) return;
      const current = nextEnvSettings[env] || { enabled: false };
      // Skip no-op writes so we don't invalidate the SDK payload cache.
      if (current.enabled !== desired) envChanged = true;
      nextEnvSettings[env] = { ...current, enabled: desired };
    });
    if (envChanged) {
      changes.environmentSettings = nextEnvSettings;
      hasChanges = true;
    }
  }

  if (result.prerequisites !== undefined) {
    changes.prerequisites = result.prerequisites;
    hasChanges = true;
  }

  if (result.archived !== undefined) {
    changes.archived = result.archived;
    hasChanges = true;
  }

  if (result.holdout !== undefined) {
    // null means remove from holdout; object means set/change holdout
    if (result.holdout === null) {
      removeHoldout = true;
    } else {
      changes.holdout = result.holdout;
    }
    hasChanges = true;
  }

  if (result.metadata) {
    const m = result.metadata;
    if (m.description !== undefined) changes.description = m.description;
    if (m.owner !== undefined) changes.owner = m.owner;
    if (m.project !== undefined) changes.project = m.project;
    if (m.targetingAllProjects !== undefined)
      changes.targetingAllProjects = m.targetingAllProjects;
    if (m.targetingProjects !== undefined)
      changes.targetingProjects = m.targetingProjects;
    if (m.tags !== undefined) changes.tags = m.tags;
    if (m.neverStale !== undefined) changes.neverStale = m.neverStale;
    if (m.customFields !== undefined)
      changes.customFields = m.customFields as Record<string, unknown>;
    if (m.jsonSchema !== undefined) changes.jsonSchema = m.jsonSchema;
    if (m.baseConfig !== undefined) changes.baseConfig = m.baseConfig;
    hasChanges = true;
  }

  // No content delta — still advance feature.version so the revision we're
  // about to mark published becomes live. Skipping this leaves a "Locked"
  // revision behind a stale feature.version, which traps subsequent reverts.
  if (!hasChanges) {
    changes.version = revision.version;
    return { changes, hasChanges, removeHoldout };
  }

  if (changes.rules !== undefined) {
    changes.nextScheduledUpdate = getNextScheduledUpdate(changes.rules);
  }

  changes.version = revision.version;

  return { changes, hasChanges, removeHoldout };
}

// Apply a revision merge result to the feature document.
export async function applyRevisionChanges(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  result: MergeResultChanges,
  // Reports the stamp the landing's guarded write PUT on the document, so the
  // caller's compensation owns the write rather than whatever a set-then-fetch
  // happened to read back.
  onStamped?: (stamp: Date) => void,
) {
  const { changes, hasChanges, removeHoldout } = computeRevisionMergeChanges(
    context,
    feature,
    revision,
    result,
  );

  // removeProjectFromFeatures only scrubs live features, so a revision staged
  // before a project deletion can still carry the dead id — drop it on publish
  // rather than restoring it into the live feature.
  const rulesHaveProjectScope = (changes.rules ?? []).some((r) =>
    Array.isArray((r as { projects?: string[] }).projects),
  );
  if (changes.targetingProjects || rulesHaveProjectScope) {
    const validProjectIds = new Set(await context.getAllProjectIds());
    if (changes.targetingProjects) {
      changes.targetingProjects = changes.targetingProjects.filter((p) =>
        validProjectIds.has(p),
      );
    }
    if (rulesHaveProjectScope) {
      changes.rules = changes.rules?.map((r) => {
        const projects = (r as { projects?: string[] }).projects;
        return Array.isArray(projects)
          ? { ...r, projects: projects.filter((p) => validProjectIds.has(p)) }
          : r;
      });
    }
  }

  // Every branch below is a landing, so its FIRST write is guarded on the
  // pre-image `feature` — the same rule as the generic entities' guarded
  // landings: two publishes of the same feature computed from the same read
  // must not both apply, whichever the caller (publish, toggle, bulk).
  const guard = { casOnDateUpdated: feature.dateUpdated, onStamped };

  if (!hasChanges) {
    return await updateFeature(context, feature, changes, guard);
  }

  let updated: FeatureInterface;
  // Handle holdout removal separately since updateFeature only does $set.
  // The holdout $unset carries the guard here because it is the landing's first
  // feature write; the follow-up content write is this landing's own turn, like
  // a config cascade after its guarded root write.
  if (removeHoldout) {
    // ONE write: the $unset rides the content $set under the same guard. As two
    // writes — even token-chained — the gap between them was a window where a
    // rival publish could land and then be overwritten, and a CAS loss on the
    // second write stranded the $unset with no rewind registered yet. The TRUE
    // pre-image goes through so hooks and events see the holdout coming off;
    // updateFeature models the $unset in its own projection.
    updated = await updateFeature(context, feature, changes, {
      ...guard,
      unsetHoldout: true,
    });
  } else {
    updated = await updateFeature(context, feature, changes, guard);
  }

  // Behind the guard on purpose: these mutate rollout statuses, timestamps and
  // schedules, and a landing that loses the CAS must leave NOTHING changed —
  // running them first meant a rejected write still returned failure with the
  // satellites already moved. And because they run AFTER the feature write, a
  // sync failure must put that write back itself: the callers' compensation
  // registers its feature rewind only on this function's success, so without
  // this undo a rollout failure left draft feature state live with the revision
  // unpublished. Value-checked restore, so a concurrent writer's newer value
  // survives; the original failure is what surfaces either way.
  try {
    await updateSafeRolloutStatuses(context, feature, revision);
  } catch (e) {
    try {
      await restorePublishedFeatureDoc(
        context,
        feature,
        revision,
        result,
        updated,
        // Re-point the caller's ownership token at the state this rollback just
        // wrote. Otherwise the outer bulk compensation compared live against the
        // ORIGINAL publish stamp, read its own successful restore as a rival taking
        // the feature, and skipped every remaining rewind — leaving the revision
        // published while the feature sat at its pre-publish version.
        onStamped,
      );
    } catch (undoErr) {
      logger.error(
        undoErr,
        `Safe-rollout sync failed for feature ${feature.id} AND the feature write could not be restored; live state is left mid-publish with the revision unpublished`,
      );
    }
    throw e;
  }

  return updated;
}

// Refuse to remove/change a feature's holdout while an experiment in the current
// draft rules for this feature is linked to the holdout.
export async function assertNoLinkedHoldoutExperiments(
  context: ReqContext | ApiReqContext,
  holdoutId: string,
  // The feature's post-publish rules (revision's merged rules)
  rules: FeatureRule[],
) {
  const experimentIds = rules
    .filter((rule) => rule.type === "experiment-ref")
    .map((rule) => rule.experimentId);

  const experiments = await Promise.all(
    experimentIds.map((eid) => getExperimentById(context, eid)),
  );
  const stillInHoldout = experiments
    .filter(
      (exp): exp is NonNullable<typeof exp> =>
        !!exp && exp.holdoutId === holdoutId,
    )
    .map((exp) => `"${exp.name}"`);
  if (stillInHoldout.length) {
    const plural = stillInHoldout.length > 1;
    throw new BadRequestError(
      `Cannot remove the holdout while experiment${plural ? "s" : ""} ${stillInHoldout.join(
        ", ",
      )} ${plural ? "are" : "is"} in the rules for this feature and in the holdout. ` +
        `Remove the experiment rule from this feature first or in the same draft.`,
    );
  }
}

// Use POST-publish rule set for `rules` so we can check for holdout compatibility
// on the draft revision and make sure the holdout change is allowed.

// Read-only so a rejection doesn't happen mid-publish and strand features.
export async function assertHoldoutChangeAllowed(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  newHoldout: { id: string; value: string } | null,
  rules: FeatureRule[],
  // `isRevert` skips the guard — a rollback restores a previously-valid holdout
  // state (the caller reverts the transiently-blocking rules moments later), so
  // this create-time check would wrongly refuse it.
  { isRevert }: { isRevert?: boolean } = {},
) {
  if (isRevert) return;

  const prevHoldoutId = feature.holdout?.id;
  const newHoldoutId = newHoldout?.id;

  // No change.
  if (newHoldoutId === prevHoldoutId) return;

  // Leaving the current holdout (removal, or a change to a different one):
  // refuse while any experiment in the rules for this feature still belongs to it. The user detaches
  // the experiment side first rather than us silently unlinking it.
  if (prevHoldoutId) {
    await assertNoLinkedHoldoutExperiments(context, prevHoldoutId, rules);
  }

  // Pure removal: nothing further to validate.
  if (newHoldout === null) return;

  // Adding or changing to a holdout: the feature's post-publish rules must not
  // carry running experiments in a different holdout, bandits, or safe rollouts.
  const currentExperimentIds = (rules ?? [])
    .filter((rule) => rule.type === "experiment-ref")
    .map((rule) => rule.experimentId);
  const experimentResults = await Promise.all(
    currentExperimentIds.map((id) => getExperimentById(context, id)),
  );
  // Filter out deleted experiments (null/undefined) before checking status
  const experiments = experimentResults.filter(
    (exp): exp is NonNullable<typeof exp> => exp !== null && exp !== undefined,
  );
  const hasNonDraftExperimentsInDifferentHoldout = experiments.some(
    (exp) => exp.status !== "draft" && exp.holdoutId !== newHoldoutId,
  );
  const hasBandits = experiments.some(
    (exp) => exp.type === "multi-armed-bandit",
  );
  const hasSafeRollouts = (rules ?? []).some(
    (rule) => rule?.type === "safe-rollout",
  );
  if (
    hasNonDraftExperimentsInDifferentHoldout ||
    hasBandits ||
    hasSafeRollouts
  ) {
    throw new BadRequestError(
      "Cannot change holdout when there are running linked experiments in different holdouts, safe rollout rules, or multi-armed bandit rules",
    );
  }
}

// Read-only, so publish paths can check this before mutating the feature.
export async function assertHoldoutLinkageResolvable(
  context: ReqContext | ApiReqContext,
  newHoldout: { id: string; value: string } | null,
  project: string | undefined,
) {
  if (!newHoldout?.id) return;
  await getHoldoutAvailableForProject({
    context,
    holdoutId: newHoldout.id,
    project,
    bypassReadPermissionChecks: true,
  });
}

// Lives here, not in services/featurePublishGates: that module already imports
// this one, and the reverse would be a runtime import cycle.
export async function collectHoldoutChangeGates({
  context,
  feature,
  mergeResult,
  isRevert,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  mergeResult: MergeResultChanges;
  isRevert?: boolean;
}): Promise<PublishGate[]> {
  if (
    mergeResult.holdout === undefined &&
    mergeResult.metadata?.project === undefined
  ) {
    return [];
  }
  const gates: PublishGate[] = [];
  const newHoldout =
    mergeResult.holdout === undefined
      ? (feature.holdout ?? null)
      : (mergeResult.holdout ?? null);

  // Merged (post-publish) rules, so a bundled experiment-ref for an
  // already-running experiment is caught.
  try {
    await assertHoldoutChangeAllowed(
      context,
      feature,
      newHoldout,
      mergeResult.rules ?? feature.rules ?? [],
      { isRevert },
    );
  } catch (e) {
    gates.push(
      makeBlockingGate({
        type: "holdout-change-conflict",
        messages: [getErrorMessage(e)],
      }),
    );
  }

  try {
    await assertHoldoutLinkageResolvable(
      context,
      newHoldout,
      mergeResult.metadata?.project ?? feature.project,
    );
  } catch (e) {
    gates.push(
      makeBlockingGate({
        type: "holdout-unresolvable",
        messages: [getErrorMessage(e)],
      }),
    );
  }

  return gates;
}

// Run HoldoutModel / Experiment side-effects when a feature's holdout
// membership changes at publish. Called from `publishRevision` when
// `result.holdout` is defined, so all publish paths (direct, approval,
// revert, etc.) are covered. `feature` is pre-publish (used for prevHoldout);
// `newHoldout: null` means "remove from holdout".
export async function applyHoldoutSideEffects(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  newHoldout: { id: string; value: string } | null,
  // `isRevert` skips the guard — see assertHoldoutChangeAllowed. `skipGuard` is
  // set by callers that already ran assertHoldoutChangeAllowed BEFORE mutating
  // the feature, so the guard isn't re-run against the stale live rules here.
  { isRevert, skipGuard }: { isRevert?: boolean; skipGuard?: boolean } = {},
) {
  const prevHoldoutId = feature.holdout?.id;
  const newHoldoutId = newHoldout?.id;

  if (newHoldoutId === prevHoldoutId) return;

  if (!skipGuard) {
    await assertHoldoutChangeAllowed(
      context,
      feature,
      newHoldout,
      feature.rules ?? [],
      { isRevert },
    );
  }

  // Resolve the new holdout BEFORE removing from the old one, so a missing
  // holdout fails with no membership mutated (no partial transition).
  await assertHoldoutLinkageResolvable(context, newHoldout, feature.project);

  // Feature side only: planHoldoutExperimentLinkage withdraws the experiments
  // this feature contributed to the holdout it is leaving.
  if (prevHoldoutId) {
    await context.models.holdout.removeFeatureFromHoldout(
      prevHoldoutId,
      feature.id,
    );
  }

  // Feature side only; planHoldoutExperimentLinkage owns the experiment half.
  if (newHoldoutId) {
    await context.models.holdout.addFeatureToHoldout(newHoldoutId, feature.id);
  }
}

export type HoldoutExperimentLinkagePlan = {
  holdoutId: string;
  toLink: string[];
  toUnlink: string[];
  // "" is the clear sentinel `updateExperiment` expects.
  prevExperimentHoldoutIds: Record<string, string>;
};

// Derived from published rules, so an edited or discarded draft leaves nothing
// to unwind.
export async function planHoldoutExperimentLinkage(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  holdoutId: string | null,
  publishedRules: FeatureRule[],
): Promise<HoldoutExperimentLinkagePlan[]> {
  const plans: HoldoutExperimentLinkagePlan[] = [];

  // Nothing else drops what this feature contributed to the holdout it is
  // leaving: the transition unlinks only the feature, and the guard that would
  // force detaching experiments first reads post-publish rules.
  const prevHoldoutId = feature.holdout?.id ?? null;
  if (prevHoldoutId && prevHoldoutId !== holdoutId) {
    const leaving = await planLinkageForHoldout(
      context,
      feature,
      prevHoldoutId,
      {
        mode: "withdraw",
        previousRules: feature.rules ?? [],
      },
    );
    if (leaving) plans.push(leaving);
  }

  if (holdoutId) {
    const joining = await planLinkageForHoldout(context, feature, holdoutId, {
      mode: "reconcile",
      publishedRules,
      previousRules: feature.rules ?? [],
    });
    if (joining) plans.push(joining);
  }

  return plans;
}

async function planLinkageForHoldout(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  holdoutId: string,
  // `previousRules` bounds what this feature may withdraw; `withdraw` publishes
  // no rules under this holdout, so everything it contributed is a candidate.
  args:
    | {
        mode: "reconcile";
        publishedRules: FeatureRule[];
        previousRules: FeatureRule[];
      }
    | { mode: "withdraw"; previousRules: FeatureRule[] },
): Promise<HoldoutExperimentLinkagePlan | null> {
  const holdout = await context.models.holdout.getByIdForLinkage(holdoutId);
  if (!holdout) return null;

  const publishedRules = args.mode === "reconcile" ? args.publishedRules : [];
  const linkedExperimentIds = Object.keys(holdout.linkedExperiments);
  const delta = (experimentIdsReferencedElsewhere: string[]) =>
    computeHoldoutExperimentLinkageDelta({
      publishedRules,
      previousRules: args.previousRules,
      linkedExperimentIds,
      experimentIdsReferencedElsewhere,
    });

  // Costed before the fan-out below: a holdout can hold a lot of features, and
  // only a withdrawal needs to know what they reference.
  const { toLink, toUnlink: candidates } = delta([]);
  if (!toLink.length && !candidates.length) return null;

  let toUnlink = candidates;
  if (candidates.length) {
    // Only other features' LIVE rules count: an unpublished draft elsewhere has
    // no linkage of its own to protect, which is what keeps this decidable.
    // TODO: consider querying with a rules[] projection if performance becomes
    // an issue — only `rules` and `holdout` are read here.
    const otherFeatures = await getFeaturesByIds(
      context,
      Object.keys(holdout.linkedFeatures).filter((id) => id !== feature.id),
    );
    toUnlink = delta(
      otherFeatures
        .filter((f) => f.holdout?.id === holdoutId)
        .flatMap((f) => getExperimentIdsFromRules(f.rules ?? [])),
    ).toUnlink;
    if (!toLink.length && !toUnlink.length) return null;
  }

  const prevExperimentHoldoutIds: Record<string, string> = {};
  await Promise.all(
    [...toLink, ...toUnlink].map(async (id) => {
      const exp = await getExperimentById(context, id);
      if (!exp) return;
      prevExperimentHoldoutIds[id] = exp.holdoutId ?? "";
      // Also checked at rule-add; re-checked here so moving the experiment
      // afterwards can't bypass it.
      if (toLink.includes(id)) {
        assertHoldoutAvailableForProject(holdout, exp.project);
      }
    }),
  );

  return { holdoutId, toLink, toUnlink, prevExperimentHoldoutIds };
}

// `holdoutId` is a scalar last-writer-wins field: a batch that lost the feature doc to
// a newer publish would still stamp its own holdout over the winner's. `expectedPrior`
// turns the forward pass into a compare-and-swap, so a rival that re-linked an
// experiment refuses us instead of being overwritten.
//
// The expectation goes in the WRITE FILTER, not a read-then-compare: between the read
// and the write there are no awaits, but "no awaits" is not "no window" — the enclosing
// `Promise.all` and event-loop lag both widen it, and a loss there is silent.
//
// Absent and `""` are the same state here (the field has no default, so absent is the
// normal one) and a bare `holdoutId: ""` clause matches neither. The empty expectation
// has to match both — the same absence subtlety `buildCasGuard` documents.
async function setExperimentHoldoutIds(
  context: ReqContext | ApiReqContext,
  targets: Record<string, string>,
  expected?: Record<string, string>,
  // What a mismatch means. Going FORWARD it is a lost race and the landing must not
  // proceed. Going BACK it means someone else now owns this experiment's linkage, and
  // the rollback leaves them alone — the same disposition `setLinkageState` and
  // `safeRollout.restoreAfterFailedBulkPublish` take.
  onMismatch: "conflict" | "skip" = "conflict",
): Promise<Set<string>> {
  // Which experiments this call actually wrote. The membership arrays have to follow
  // the same decision — see `reverseHoldoutExperimentLinkage`.
  const applied = new Set<string>();
  // Every write SETTLES before a failure is surfaced. `Promise.all` rejects on the
  // first while its siblings keep running, so compensation could inspect an
  // experiment before its scalar write had landed, judge it unowned, and have that
  // write arrive after the rollback. Same requirement as the contextual-bandit batch.
  const outcomes = await Promise.all(
    // The try covers the READ as well as the write. With only the write inside it, a
    // failed `getExperimentById` still rejected its entry, which rejects `Promise.all`
    // at once and settles nothing — exactly the escape this comment says is closed.
    Object.entries(targets).map(async ([id, next]) => {
      try {
        const exp = await getExperimentById(context, id);
        if (!exp) return null;
        // Already where we want it: nothing to write, but it IS at the target, so it
        // counts as ours for the membership decision. A forward pass that failed
        // between the membership write and the scalar leaves exactly this state, and
        // treating it as "not ours" would strand the membership half.
        if ((exp.holdoutId ?? "") === next) {
          applied.add(id);
          return null;
        }
        const want = expected?.[id];
        await updateExperiment({
          context,
          experiment: exp,
          changes: { holdoutId: next },
          ...(expected
            ? { guard: { holdoutId: want ? want : { $in: [null, ""] } } }
            : {}),
        });
        applied.add(id);
        return null;
      } catch (e) {
        if (onMismatch === "skip" && e instanceof CasConflictError) return null;
        return e;
      }
    }),
  );
  const failure = outcomes.find((e) => e !== null && e !== undefined);
  if (failure) throw failure;
  return applied;
}

export async function applyHoldoutExperimentLinkage(
  context: ReqContext | ApiReqContext,
  plan: HoldoutExperimentLinkagePlan,
  // What this SEQUENCE of plans has already written, mutated as each one applies.
  //
  // A holdout change emits two plans — leave, then join — and both are computed
  // before either applies, so they share one pre-image. For an experiment named by
  // both, the join's expectation is stale the moment the leave writes it, and the
  // guard would reject a conflict with our own earlier step: the same revert failing
  // identically on every retry. Chaining makes each plan expect what the last left.
  chain?: Record<string, string>,
) {
  // The SCALAR first, then membership for the experiments it actually claimed —
  // the same order the rewind uses, and for the same reason. Writing membership
  // first meant an experiment whose scalar then went to a different owner kept the
  // membership this publish had added: compensation correctly skips that experiment
  // as theirs, so nothing was ever left to remove it.
  const { targets, expectedPrior } = holdoutLinkageWrites(plan, chain);
  const applied = await setExperimentHoldoutIds(
    context,
    targets,
    expectedPrior,
  );
  await context.models.holdout.addExperimentsToHoldout(
    plan.holdoutId,
    plan.toLink.filter((id) => applied.has(id)),
  );
  await context.models.holdout.removeExperimentsFromHoldout(
    plan.holdoutId,
    plan.toUnlink.filter((id) => applied.has(id)),
  );
  if (chain) {
    for (const [id, next] of Object.entries(targets)) {
      if (applied.has(id)) chain[id] = next;
    }
  }
}

/**
 * What one plan writes, and what each write expects to find.
 *
 * Pure and exported for its own test: the expectation is the whole correctness
 * question, and getting it from the shared pre-image alone made a holdout CHANGE
 * fail its own second plan — identically on every retry.
 */
export function holdoutLinkageWrites(
  plan: HoldoutExperimentLinkagePlan,
  chain?: Record<string, string>,
): { targets: Record<string, string>; expectedPrior: Record<string, string> } {
  const targets: Record<string, string> = {
    ...Object.fromEntries(plan.toLink.map((id) => [id, plan.holdoutId])),
    ...Object.fromEntries(plan.toUnlink.map((id) => [id, ""])),
  };
  return {
    targets,
    expectedPrior: Object.fromEntries(
      Object.keys(targets).map((id) => [
        id,
        // What an earlier plan in this sequence left, falling back to the pre-image
        // for an experiment this sequence has not touched yet.
        chain?.[id] ?? plan.prevExperimentHoldoutIds[id] ?? "",
      ]),
    ),
  };
}

// Converges to the pre-image rather than inverting each write, so a forward pass that
// failed partway still lands on the pre-publish state — but only for experiments still
// holding what THIS plan wrote. The bulk ownership check proves the feature doc is
// still ours; it says nothing about an experiment, which another feature's publish or
// a direct edit can move while we are in flight. Converging unconditionally would
// erase them. An experiment the forward pass never reached needs nothing undone, and
// is skipped by the same comparison.
export async function reverseHoldoutExperimentLinkage(
  context: ReqContext | ApiReqContext,
  plan: HoldoutExperimentLinkagePlan,
) {
  // The SCALAR first, because it decides ownership. Throws on failure: publishRevision
  // treats this as a satellite and carries on to the feature document, while bulk
  // compensation records it and reports the item stuck rather than cleanly rolled
  // back. A skipped experiment is not a failure — it is a different owner.
  const { targets } = holdoutLinkageWrites(plan);
  const reverted = await setExperimentHoldoutIds(
    context,
    plan.prevExperimentHoldoutIds,
    targets,
    "skip",
  );
  // Membership follows the scalar. Rewinding it unconditionally undid the teammate's
  // half of a linkage whose scalar we had just declined to touch, leaving
  // `linkedExperiments` and `holdoutId` disagreeing — and a later publish reads the
  // live scalar as its expectation, matches, and quietly pulls the experiment out of
  // their holdout. The two have to move together or not at all.
  //
  // An experiment the forward pass never reached is absent from `reverted` too, and
  // needs no membership change either.
  await context.models.holdout.addExperimentsToHoldout(
    plan.holdoutId,
    plan.toUnlink.filter((id) => reverted.has(id)),
  );
  await context.models.holdout.removeExperimentsFromHoldout(
    plan.holdoutId,
    plan.toLink.filter((id) => reverted.has(id)),
  );
}

// The linkage a holdout transition is about to write, captured before the forward
// pass so its rewind can restore the pre-publish state instead of re-deriving it
// by running the transition backwards (which cannot express "there was no
// holdout" and mis-attributes experiments the draft newly added).
export type HoldoutLinkagePreImage = {
  featureId: string;
  prevHoldoutId: string | null;
  // The old holdout's `linkedFeatures` entry for this feature, so the rewind puts
  // it back with its original `dateAdded`. Null when it was not linked.
  prevFeatureEntry: { id: string; dateAdded: Date } | null;
  newHoldoutId: string | null;
  addsFeature: boolean;
};

export async function captureHoldoutLinkagePreImage(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  newHoldout: { id: string } | null,
): Promise<HoldoutLinkagePreImage | null> {
  const prevHoldoutId = feature.holdout?.id ?? null;
  const newHoldoutId = newHoldout?.id ?? null;
  if (newHoldoutId === prevHoldoutId) return null;

  const newHoldoutDoc = newHoldoutId
    ? await context.models.holdout.getByIdForLinkage(newHoldoutId)
    : null;
  const prevHoldoutDoc = prevHoldoutId
    ? await context.models.holdout.getByIdForLinkage(prevHoldoutId)
    : null;

  return {
    featureId: feature.id,
    prevHoldoutId,
    prevFeatureEntry: prevHoldoutDoc?.linkedFeatures[feature.id] ?? null,
    newHoldoutId,
    // Only what this publish adds: an entry that was already there belongs to
    // another writer and must survive the rewind.
    addsFeature: !!newHoldoutDoc && !newHoldoutDoc.linkedFeatures[feature.id],
  };
}

// Undoes exactly what `applyHoldoutSideEffects` wrote for this publish. Every
// step converges on the captured value, so it is a no-op when the forward pass
// never landed.
export async function rewindHoldoutLinkage(
  context: ReqContext | ApiReqContext,
  pre: HoldoutLinkagePreImage,
) {
  if (pre.newHoldoutId && pre.addsFeature) {
    // Only remove the entry THIS publish added, and only while it is still the one
    // it added: a concurrent writer who re-linked the feature to the same holdout
    // owns that entry now, and dropping it would undo their change. The restore
    // half below already declines on the same reasoning.
    const newHoldout = await context.models.holdout.getByIdForLinkage(
      pre.newHoldoutId,
    );
    if (newHoldout?.linkedFeatures[pre.featureId]) {
      await context.models.holdout.removeLinkageFromHoldout(pre.newHoldoutId, {
        featureId: pre.featureId,
      });
    }
  }

  if (pre.prevHoldoutId && pre.prevFeatureEntry) {
    // Skip when something already occupies the slot — re-adding would clobber
    // a linkage written after this publish failed.
    const prevHoldout = await context.models.holdout.getByIdForLinkage(
      pre.prevHoldoutId,
    );
    if (prevHoldout && !prevHoldout.linkedFeatures[pre.featureId]) {
      await context.models.holdout.restoreFeatureLinkage(
        pre.prevHoldoutId,
        pre.prevFeatureEntry,
      );
    }
  }
}

// Phase-shaped ramp-action surface for the bulk publisher: creates run BEFORE
// the feature write (a failure gates the publish; ids returned for rollback),
// updates/detaches/cleanup run after a known-good publish as best-effort.
export async function applyRampCreateActionsForRevision(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  result: MergeResultChanges,
): Promise<string[]> {
  const createActions = (revision.rampActions ?? []).filter(
    (a) => a.mode === "create",
  );
  if (!createActions.length) return [];
  const createdIds: string[] = [];
  try {
    return await createRampSchedulesForRevision(
      context,
      feature,
      revision,
      result,
      createActions,
      createdIds,
    );
  } catch (e) {
    // A mid-loop throw would otherwise orphan the schedules already created —
    // invisible to compensation (their ids die with the throw). Best-effort
    // delete them here; the original error still gates the publish.
    await rollbackCreatedRampSchedules(context, createdIds);
    throw e;
  }
}

// Delete ramp schedules a failed publish created. Returns the ids it could NOT
// delete so the caller can surface them as a reversal failure — a swallowed
// delete would leave an armed `pending` schedule behind while the item reports
// a clean rollback (it activates if that revision is ever re-published).
export async function rollbackCreatedRampSchedules(
  context: ReqContext | ApiReqContext,
  scheduleIds: string[],
): Promise<string[]> {
  const failed: string[] = [];
  for (const id of scheduleIds) {
    try {
      await context.models.rampSchedules.dangerousDeleteByIdBypassPermission(
        id,
      );
    } catch (deleteErr) {
      failed.push(id);
      logger.error(
        deleteErr,
        `Failed to delete orphaned ramp schedule ${id} during publish rollback`,
      );
    }
  }
  return failed;
}

export async function finalizeRampActionsAfterPublish(
  context: ReqContext | ApiReqContext,
  featureBefore: FeatureInterface,
  featureAfter: FeatureInterface,
  revision: FeatureRevisionInterface,
  result: MergeResultChanges,
): Promise<void> {
  const updateActions = (revision.rampActions ?? []).filter(
    (a) => a.mode === "update",
  );
  if (updateActions.length) {
    try {
      await createRampSchedulesForRevision(
        context,
        featureAfter,
        revision,
        result,
        updateActions,
      );
    } catch (err) {
      logger.error(
        err,
        "Failed to apply deferred ramp update actions after publish",
      );
    }
  }
  if (revision.rampActions?.length) {
    await applyDetachRampActions(context, revision.rampActions);
  }
  await cleanupOrphanedRampSchedules(context, featureBefore, featureAfter);
}

async function createRampSchedulesForRevision(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: { version: number },
  result: MergeResultChanges,
  actions: RevisionRampAction[],
  // Written to as each schedule is created, so a caller keeps the partial set
  // if a later action throws (the return value would be lost with the throw).
  createdIds: string[] = [],
): Promise<string[]> {
  for (const action of actions) {
    if (action.mode !== "create" && action.mode !== "update") continue;

    // Pro gate — see postRampSchedule.ts for rationale.
    if (!context.hasPremiumFeature("schedule-feature-flag")) {
      context.throwPlanDoesNotAllowError(
        "Ramp schedules require a Pro plan or above.",
      );
    }

    const existingSchedule =
      action.mode === "update"
        ? await context.models.rampSchedules.getById(action.rampScheduleId)
        : null;
    if (action.mode === "update" && !existingSchedule) {
      logger.warn(
        { rampScheduleId: action.rampScheduleId, ruleId: action.ruleId },
        "Ramp schedule not found at revision publish time — skipping deferred update action",
      );
      continue;
    }

    const existingTarget =
      action.mode === "update"
        ? existingSchedule?.targets.find(
            (t) => stemRuleId(t.ruleId ?? "") === stemRuleId(action.ruleId),
          )
        : null;
    if (action.mode === "update" && !existingTarget) {
      logger.warn(
        {
          rampScheduleId: action.rampScheduleId,
          ruleId: action.ruleId,
        },
        "Ramp schedule target no longer matches rule at revision publish time — skipping deferred update action",
      );
      continue;
    }

    const targetId = existingTarget?.id ?? uuidv4();

    // Inject the generated targetId into every action and ensure targetType
    // is always set. Handles both correctly-typed actions and legacy drafts
    // that were stored without targetType.
    const normalizeAction = (
      a: RevisionRampCreateAction["steps"][number]["actions"][number],
    ): RampStepAction => ({
      targetType: "feature-rule" as const,
      targetId,
      patch: {
        ...a.patch,
        ruleId: action.ruleId,
      },
    });

    // Template is used as a fallback; explicit steps/endActions win.
    let template: RampScheduleTemplateInterface | undefined;
    if (action.templateId) {
      const tmpl = await context.models.rampScheduleTemplates.getById(
        action.templateId,
      );
      if (!tmpl) {
        logger.warn(
          { templateId: action.templateId },
          "Ramp schedule template not found at revision publish time — skipping template",
        );
      } else {
        template = tmpl;
      }
    }

    const defaultName = `Ramp schedule \u2013 ${new Date().toLocaleDateString(
      "en-US",
      { month: "short", year: "numeric" },
    )}`;

    const startDate =
      action.startDate === null
        ? null
        : action.startDate
          ? new Date(action.startDate)
          : undefined;

    const explicitSteps = Array.isArray(action.steps) ? action.steps : [];
    // Whether the caller explicitly provided steps (only when at least one step
    // is present, or a template is used). When false on an update action,
    // fall back to the existing schedule's steps to avoid wiping them.
    // Note: steps: [] is treated as "not provided" — an empty array does NOT
    // clear existing steps.
    const stepsExplicit = explicitSteps.length > 0 || !!template;
    const steps: RampScheduleInterface["steps"] =
      explicitSteps.length > 0
        ? explicitSteps.map((step) => ({
            ...step,
            actions: Array.isArray(step.actions)
              ? step.actions.map(normalizeAction)
              : [],
            monitored: !!step.monitored,
            holdConditions: step.holdConditions ?? undefined,
          }))
        : template
          ? template.steps.map((s) => ({
              interval: s.interval,
              actions: remapTemplateActions(
                s.actions,
                targetId,
                action.ruleId,
                feature.valueType,
              ),
              approvalNotes: s.approvalNotes ?? undefined,
              monitored: !!s.monitored,
              holdConditions: s.holdConditions ?? undefined,
            }))
          : action.mode === "update"
            ? // No explicit steps and no template: preserve the existing
              // schedule's steps so a caller who only wants to change name /
              // startDate / cutoffDate doesn't accidentally wipe them.
              (existingSchedule?.steps ?? [])
            : [];

    // null = explicitly cleared (skip template); undefined = not set (fall back to template).
    const endActions: RampStepAction[] =
      action.endActions !== undefined
        ? Array.isArray(action.endActions)
          ? action.endActions.map(normalizeAction)
          : []
        : template?.endPatch && Object.keys(template.endPatch).length > 0
          ? [
              {
                targetType: "feature-rule" as const,
                targetId,
                patch: {
                  ruleId: action.ruleId,
                  ...template.endPatch,
                },
              },
            ]
          : [];

    const startActions: RampStepAction[] =
      action.startActions !== undefined
        ? Array.isArray(action.startActions)
          ? action.startActions.map(normalizeAction)
          : []
        : getStartActionsFromRules({
            rules: result.rules ?? feature.rules ?? [],
            targetId,
            ruleId: action.ruleId,
            environment: action.environment,
          });

    if (action.mode === "create") {
      // Guard against duplicate schedules: if the revision is re-published or
      // an older revision is published while a live schedule already targets
      // this rule, skip the create rather than producing a second schedule
      // that both try to drive the same rule.
      const existing = await context.models.rampSchedules.findByTargetRule(
        action.ruleId,
        action.environment ?? undefined,
      );
      if (existing.length > 0) {
        logger.warn(
          {
            ruleId: action.ruleId,
            conflictingScheduleId: existing[0].id,
            revisionVersion: revision.version,
          },
          "Skipping deferred ramp create action — a live schedule already targets this rule",
        );
        continue;
      }

      const created = await context.models.rampSchedules.create({
        name: action.name ?? defaultName,
        entityType: "feature",
        entityId: feature.id,
        targets: [
          {
            id: targetId,
            entityType: "feature",
            entityId: feature.id,
            ruleId: action.ruleId,
            // null = patches apply to all environments sharing this ruleId.
            // A specific environment = patches are scoped to that env only.
            environment: action.environment ?? null,
            status: "active",
            // Link this target to the activating revision so onRevisionPublished
            // (and the Agenda recovery path) can transition "pending" → "running".
            activatingRevisionVersion: revision.version,
          },
        ],
        startActions: startActions.length > 0 ? startActions : undefined,
        steps,
        endActions: endActions.length > 0 ? endActions : undefined,
        startDate: startDate ?? undefined,
        cutoffDate: action.cutoffDate
          ? new Date(action.cutoffDate)
          : action.cutoffDate === null
            ? null
            : undefined,
        monitoringConfig: action.monitoringConfig ?? template?.monitoringConfig,
        lockdownConfig: action.lockdownConfig ?? template?.lockdownConfig,
        // Per-launch decision — deliberately sourced only from the action, never
        // from the template (templates capture reusable shape, not start-gating).
        requiresStartApproval: action.requiresStartApproval || undefined,
        // Start as "pending" — onActivatingRevisionPublished handles the
        // immediate → "running" transition inline when the revision publishes.
        status: "pending",
        currentStepIndex: -1,
        nextStepAt:
          !startDate && steps.length > 0 ? new Date() : (startDate ?? null),
        startedAt: null,
        phaseStartedAt: null,
      });

      createdIds.push(created.id);
      continue;
    }

    const updateAction = action as RevisionRampUpdateAction;
    const nextStartDate =
      startDate !== undefined
        ? startDate
        : (existingSchedule?.startDate ?? null);
    const nextCutoffDate =
      updateAction.cutoffDate !== undefined
        ? updateAction.cutoffDate
          ? new Date(updateAction.cutoffDate)
          : null
        : (existingSchedule?.cutoffDate ?? null);
    const nextMonitoringConfig =
      updateAction.monitoringConfig !== undefined
        ? updateAction.monitoringConfig
        : existingSchedule?.monitoringConfig;
    // Resolve the post-edit approval strategy (tri-state; see resolveStartApproval).
    // When still on and unapproved, the ramp must NOT start now.
    const nextRequiresApproval = resolveStartApproval(
      updateAction.requiresStartApproval,
      existingSchedule?.requiresStartApproval,
    );
    const heldForApproval =
      nextRequiresApproval && !existingSchedule?.startApprovedAt;
    // "Start now": user explicitly cleared startDate on a not-yet-started
    // schedule. Transition ready → running inline so the rule goes live on
    // publish instead of at the next poller tick. A ready schedule has all
    // fields editable (startActions included — the ramp hasn't fired), so no
    // running-merge / paused-clamp handling is needed here. Excluded when the
    // edit selects "on approval" — that holds, it doesn't start.
    let startDeferredToScheduler = false;
    if (
      updateAction.startDate === null &&
      existingSchedule?.status === "ready" &&
      !heldForApproval
    ) {
      const contentUpdates: Parameters<typeof startReadyScheduleNow>[2] = {};
      const edited: string[] = [];
      const set = (provided: boolean, key: string, value: unknown) => {
        if (!provided) return;
        (contentUpdates as Record<string, unknown>)[key] = value;
        edited.push(key);
      };
      set(updateAction.name !== undefined, "name", updateAction.name);
      set(
        updateAction.startActions !== undefined,
        "startActions",
        startActions.length > 0 ? startActions : undefined,
      );
      set(stepsExplicit, "steps", steps);
      set(
        updateAction.endActions !== undefined,
        "endActions",
        endActions.length > 0 ? endActions : undefined,
      );
      set(updateAction.cutoffDate !== undefined, "cutoffDate", nextCutoffDate);
      set(
        updateAction.monitoringConfig !== undefined,
        "monitoringConfig",
        nextMonitoringConfig,
      );
      set(
        updateAction.lockdownConfig !== undefined,
        "lockdownConfig",
        updateAction.lockdownConfig,
      );
      // Persist the resolved start-approval alongside the start. Reaching here
      // means the ramp is not held (nextRequiresApproval is off, or on but
      // already approved), so this write is what clears an unchecked gate before
      // the start tripwire runs. Clear a stale approval marker on a real toggle.
      set(
        updateAction.requiresStartApproval !== undefined,
        "requiresStartApproval",
        nextRequiresApproval,
      );
      if (
        updateAction.requiresStartApproval !== undefined &&
        nextRequiresApproval !== !!existingSchedule?.requiresStartApproval
      ) {
        (contentUpdates as Record<string, unknown>).startApprovedAt = null;
      }
      edited.push("startDate"); // always changed on this path (cleared)

      // A "config-edited" event rides along so startReadyScheduleNow appends
      // "started" on top of it, matching the direct-edit path.
      const history = appendRampEvent(existingSchedule, "config-edited", {
        stepIndex: existingSchedule.currentStepIndex,
        status: existingSchedule.status,
        reason: `Edited via draft: ${edited.join(", ")}`,
      });
      const started = await startReadyScheduleNow(context, existingSchedule, {
        ...contentUpdates,
        cutoffDate: nextCutoffDate,
        auditEvent: history[history.length - 1],
      });
      if (started) continue;
      // Start didn't run: either the scheduler started it first (the locked
      // update below applies the edits) or the lock stayed busy and the start
      // was deferred via startDate=now — don't clobber that deferral.
      const reread = await context.models.rampSchedules.getById(
        updateAction.rampScheduleId,
      );
      if (!reread) {
        logger.warn(
          { rampScheduleId: updateAction.rampScheduleId },
          "Ramp schedule removed while applying start-now update — skipping",
        );
        continue;
      }
      startDeferredToScheduler = reread.status === "ready";
    }

    // Apply the edits under the advance lock, deriving state-dependent pieces
    // (running merge, paused clamp, audit history, nextProcessAt inputs) from
    // the in-lock fresh doc — the schedule may have started, advanced, or been
    // edited since the pre-publish read.
    try {
      await runLockedRampScheduleAction(
        context,
        updateAction.rampScheduleId,
        async (fresh) => {
          const isRunning = fresh.status === "running";
          const canEditStartActions =
            fresh.status === "pending" || fresh.status === "ready";
          const startDateChanged = updateAction.startDate !== undefined;

          // Collect the caller's config edits. `set` writes a key only when the
          // field was provided, so omitted fields are preserved, and records
          // which fields changed for the audit trail.
          const patch: Record<string, unknown> = {};
          const edited: string[] = [];
          const set = (provided: boolean, key: string, value: unknown) => {
            if (!provided) return;
            patch[key] = value;
            edited.push(key);
          };

          set(updateAction.name !== undefined, "name", updateAction.name);
          set(
            updateAction.cutoffDate !== undefined,
            "cutoffDate",
            nextCutoffDate,
          );
          set(
            updateAction.monitoringConfig !== undefined,
            "monitoringConfig",
            nextMonitoringConfig,
          );
          set(
            updateAction.lockdownConfig !== undefined,
            "lockdownConfig",
            updateAction.lockdownConfig,
          );
          // endActions only apply at completion, so they're safe to edit mid-run.
          set(
            updateAction.endActions !== undefined,
            "endActions",
            endActions.length > 0 ? endActions : undefined,
          );

          if (isRunning) {
            // Running TOCTOU guard: freeze the past, allow only holds/notes on
            // the current step, apply future steps. startActions stay frozen —
            // they're the rollback restore point.
            if (stepsExplicit) {
              set(
                true,
                "steps",
                mergeStepsForRunningSchedule(fresh, steps).steps,
              );
            }
          } else {
            set(stepsExplicit, "steps", steps);
            set(
              canEditStartActions && updateAction.startActions !== undefined,
              "startActions",
              startActions.length > 0 ? startActions : undefined,
            );
            // Start strategy is a pre-start decision — only editable while the
            // ramp hasn't crossed into step 0. Toggling it on re-arms the
            // approval gate (clear the marker); toggling off lets the
            // immediate/date logic take over.
            if (
              canEditStartActions &&
              updateAction.requiresStartApproval !== undefined
            ) {
              set(true, "requiresStartApproval", nextRequiresApproval);
              // Re-arm only when the gate actually toggles — preserve a granted
              // approval across unrelated edits (the client re-sends the field
              // on every edit).
              if (
                nextRequiresApproval !==
                !!existingSchedule?.requiresStartApproval
              ) {
                patch.startApprovedAt = null;
              }
            }
            if (startDateChanged) edited.push("startDate");
            if (startDateChanged && !startDeferredToScheduler) {
              patch.startDate = nextStartDate;
            }
            // Steps edited on a paused schedule: clamp the playhead and let
            // resume recompute timing. Internal fields, not part of the audit.
            if (
              fresh.status === "paused" &&
              fresh.currentStepIndex >= steps.length
            ) {
              patch.currentStepIndex = Math.max(steps.length - 1, -1);
              patch.nextStepAt = null;
            }
          }

          if (edited.length > 0) {
            patch.eventHistory = appendRampEvent(fresh, "config-edited", {
              stepIndex: fresh.currentStepIndex,
              status: fresh.status,
              reason: `Edited via draft: ${edited.join(", ")}`,
            });
          }

          patch.nextProcessAt = computeNextProcessAt({
            status: fresh.status,
            nextStepAt: fresh.nextStepAt,
            cutoffDate:
              updateAction.cutoffDate !== undefined
                ? nextCutoffDate
                : (fresh.cutoffDate ?? null),
            // running ignores startDate; ready uses it. Only reflect the new
            // startDate when we actually persist it here.
            startDate:
              !isRunning && startDateChanged && !startDeferredToScheduler
                ? nextStartDate
                : (fresh.startDate ?? null),
            nextSnapshotAt: fresh.nextSnapshotAt,
            requiresStartApproval: nextRequiresApproval,
            startApprovedAt:
              "startApprovedAt" in patch
                ? (patch.startApprovedAt as Date | null)
                : fresh.startApprovedAt,
          });

          const updated = await context.models.rampSchedules.updateById(
            fresh.id,
            patch,
          );

          // Sync SafeRollout in case monitored-step membership changed.
          if (isRunning && patch.steps) {
            const ensured = await ensureSafeRolloutForMonitoredRamp(
              context,
              updated,
            );
            await syncLinkedSafeRolloutForRampState(context, ensured);
          }
        },
      );
    } catch (e) {
      if (e instanceof NotFoundError) {
        logger.warn(
          { rampScheduleId: updateAction.rampScheduleId },
          "Ramp schedule removed while applying update action — skipping",
        );
        continue;
      }
      throw e;
    }
  }

  return createdIds;
}

/**
 * Apply detach/update ramp actions stored on a revision.
 * Best-effort: logs errors but does not throw, since these run after the feature is published.
 */
async function applyDetachRampActions(
  context: ReqContext | ApiReqContext,
  actions: RevisionRampAction[],
) {
  for (const action of actions) {
    if (action.mode !== "detach") continue;
    try {
      const existing = await context.models.rampSchedules.getById(
        action.rampScheduleId,
      );
      if (existing) {
        // Stem-match so a bare `fr_abc` detach action matches a suffixed
        // `fr_abc__production` target (and vice versa).
        const actionStem = stemRuleId(action.ruleId);
        const remainingTargets = existing.targets.filter(
          (t) => stemRuleId(t.ruleId ?? "") !== actionStem,
        );
        if (action.deleteScheduleWhenEmpty && remainingTargets.length === 0) {
          // Stop the linked SafeRollout before deletion so it doesn't continue
          // taking snapshots against a ramp that no longer exists.
          if (existing.safeRolloutId) {
            await syncLinkedSafeRolloutForRampState(
              context,
              { ...existing, status: "rolled-back" },
              "stopped",
            );
          }
          await context.models.rampSchedules.dangerousDeleteByIdBypassPermission(
            existing.id,
          );
        } else {
          await context.models.rampSchedules.updateById(existing.id, {
            targets: remainingTargets,
          });
        }
      }
    } catch (err) {
      logger.error(err, {
        msg: "Failed to apply revision ramp detach action",
        action,
      });
    }
  }
}

async function cleanupOrphanedRampSchedules(
  context: ReqContext | ApiReqContext,
  oldFeature: FeatureInterface,
  newFeature: FeatureInterface,
) {
  try {
    // When publishing a change that modifies rules, clean up ramp schedules that
    // become orphaned. This handles several scenarios:
    // 1. Rules that target a ramp are deleted → ramp is cleaned up
    // 2. Reverting to an older revision that predates a ramp's creation → ramp's
    //    targets (from newer revisions) are removed, orphaning the ramp → cleanup deletes it
    // 3. Reverting back to a newer revision with a ramp → the ramp is recreated via
    //    the inline "create" action on the rule (natural behavior)
    //
    // Note: If a ramp schedule is deleted and then we revert to a future revision
    // where it should exist, the "create" action will not fire again. The user must
    // re-create the ramp. This is the safe, explicit behavior.

    // Compare by stem (not raw id). A rule may be split across revisions —
    // e.g. `fr_abc` → `fr_abc__production` + `fr_abc__dev` — and ramp
    // targets reference stem identity.
    const oldStems = new Set<string>(
      (oldFeature.rules ?? [])
        .map((r) => (r?.id ? stemRuleId(r.id) : null))
        .filter((id): id is string => !!id),
    );
    const newStems = new Set<string>(
      (newFeature.rules ?? [])
        .map((r) => (r?.id ? stemRuleId(r.id) : null))
        .filter((id): id is string => !!id),
    );

    const deletedStems = new Set<string>(
      [...oldStems].filter((s) => !newStems.has(s)),
    );

    const allRamps = await context.models?.rampSchedules?.getAllByFeatureId?.(
      newFeature.id,
    );

    if (!allRamps) return;

    for (const ramp of allRamps) {
      const originalTargets = ramp?.targets ?? [];
      if (originalTargets.length === 0 || !ramp?.id) continue;
      const remainingTargets = originalTargets.filter(
        (target: RampScheduleInterface["targets"][0]) => {
          if (!target?.ruleId) return false;
          return !deletedStems.has(stemRuleId(target.ruleId));
        },
      );

      if (remainingTargets.length === 0) {
        // Stop the linked SafeRollout before deletion so it doesn't continue
        // taking snapshots against a ramp that no longer exists.
        if (ramp.safeRolloutId) {
          await syncLinkedSafeRolloutForRampState(
            context,
            { ...ramp, status: "rolled-back" },
            "stopped",
          );
        }
        await context.models?.rampSchedules?.dangerousDeleteByIdBypassPermission?.(
          ramp.id,
        );
      } else if (remainingTargets.length !== originalTargets.length) {
        // Some targets were orphaned by the delete; prune them so the schedule
        // doesn't fail trying to resolve a deleted ruleId on its next fire.
        await context.models?.rampSchedules?.updateById?.(ramp.id, {
          targets: remainingTargets,
        });
      }
    }
  } catch (error) {
    // Log but don't throw — cleanup is a nice-to-have, not essential for publish to succeed.
    logger.error("Error cleaning up orphaned ramp schedules", error);
  }
}

// Compute the feature as it will look post-publish, plus the exact
// default/rules subset the config-backed value net must re-check. Shared by
// prevalidatePublishRevision (the throwing choke point) and the REST publish
// handler (which runs the same net non-throwing as publish gates). Only values
// THIS publish changes are checked — a pre-existing violation must not block
// status-only publishes (kill switches, safe-rollout rollbacks, ramp advances).
// A baseConfig change re-checks everything (new backing schema).
export function computeProposedFeatureForValidation(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  result: MergeResultChanges,
): {
  proposedFeature: FeatureInterface;
  defaultToCheck: string | undefined;
  rulesToCheck: FeatureRule[];
} {
  const { changes, removeHoldout } = computeRevisionMergeChanges(
    context,
    feature,
    revision,
    result,
  );
  const base = removeHoldout
    ? (omit(feature, ["holdout"]) as FeatureInterface)
    : feature;
  const proposedFeature: FeatureInterface = {
    ...base,
    ...changes,
    dateUpdated: new Date(),
  };
  proposedFeature.linkedExperiments = getLinkedExperiments(proposedFeature);
  const backingChanged =
    changes.baseConfig !== undefined &&
    (changes.baseConfig ?? null) !== (feature.baseConfig ?? null);
  const liveRuleById = new Map((feature.rules ?? []).map((r) => [r.id, r]));
  const rulesToCheck = backingChanged
    ? (proposedFeature.rules ?? [])
    : (changes.rules ?? []).filter((r) => {
        const live = liveRuleById.get(r.id);
        return (
          !live ||
          !isEqual(configCheckedRuleValues(live), configCheckedRuleValues(r))
        );
      });
  const defaultToCheck =
    backingChanged ||
    (changes.defaultValue !== undefined &&
      changes.defaultValue !== feature.defaultValue)
      ? proposedFeature.defaultValue
      : undefined;
  return { proposedFeature, defaultToCheck, rulesToCheck };
}

// Best-effort early hook run; updateFeature / markRevisionAsPublished re-run hooks authoritatively.
// `skipValidation` is set by callers that already ran these checks against this
// exact revision — the REST publish handler surfaces them as publish gates, and
// the auto-publish paths run them as a pre-insert gate — so the sandboxed hooks
// don't double-execute. The proposed feature is still computed for callers.
export async function prevalidatePublishRevision({
  context,
  feature,
  revision,
  result,
  comment,
  skipValidation,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  result: MergeResultChanges;
  comment?: string;
  skipValidation?: boolean;
}) {
  const { proposedFeature, defaultToCheck, rulesToCheck } =
    computeProposedFeatureForValidation(context, feature, revision, result);
  if (skipValidation) return;
  // Re-validate config-backed values going live: save-time validation can be
  // stale (a config's schema/invariants may tighten between draft and publish),
  // and auto-publish paths don't pass through a REST handler's own net.
  if (defaultToCheck !== undefined || rulesToCheck.length) {
    await assertConfigBackedFeatureValuesValid(context, proposedFeature, {
      defaultValue: defaultToCheck,
      rules: rulesToCheck,
    });
  }
  await runValidateFeatureHooks({
    context,
    feature: proposedFeature,
    original: feature,
  });
  await runValidateFeatureRevisionHooks({
    context,
    feature,
    revision: {
      ...revision,
      ...computeRevisionPublishChanges(revision, context.auditUser, comment),
    },
    original: revision,
  });
}

// Live-baseline revision built from the feature doc (canonical live state), without writing.
export async function getLiveBaselineRevision(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
): Promise<FeatureRevisionInterface> {
  const liveRevision = await getRevision({
    context,
    organization: feature.organization,
    featureId: feature.id,
    feature,
    version: feature.version,
  });
  if (!liveRevision) throw new Error("Could not load live revision");
  return {
    ...liveRevision,
    ...liveRevisionFromFeature(liveRevision, feature),
  } as FeatureRevisionInterface;
}

// Restores a key only while the live doc still holds the value this publish
// wrote — a concurrent writer's different value is newer intent.
async function restorePublishedFeatureDoc(
  context: ReqContext | ApiReqContext,
  preImage: FeatureInterface,
  revision: FeatureRevisionInterface,
  result: MergeResultChanges,
  // The persisted post-apply doc, not the computed $set: applyRevisionChanges
  // mutates `changes` before writing and the read-back normalizes further.
  writtenFeature: FeatureInterface,
  // Reports the stamp THIS restore put on the document. A restore is a write, so it
  // advances `dateUpdated` — and the caller's ownership token is the stamp of the
  // original publish write, so without this the caller's own rollback looked like a
  // concurrent owner and every remaining rewind was skipped.
  onStamped?: (stamp: Date) => void,
) {
  const { changes } = computeRevisionMergeChanges(
    context,
    preImage,
    revision,
    result,
  );
  const restoreKeys = new Set([
    ...Object.keys(changes),
    "version",
    // updateFeature derives this rather than taking it from `changes`, and it
    // only ever appends — so restoring the rules alone would leave the feature
    // listing experiments whose own back-reference the rewind just removed.
    "linkedExperiments",
  ]);
  // A holdout removal lands via the same write's $unset rather than `changes`,
  // so name the key explicitly whenever this publish transitioned it.
  if (result.holdout !== undefined) restoreKeys.add("holdout");

  // Read-decide-write under guard, retried — the feature twin of the generic
  // restore in landingSequence: an unguarded restore could replace a newer
  // publish landing between the ownership read and the write. On a loss,
  // re-read and re-decide; the newer landing's keys drop out by value.
  const maxAttempts = 3;
  for (let attempt = 1; ; attempt++) {
    const current = await getFeature(context, preImage.id);
    if (!current) return;

    const restore = ownedRestoreValues({
      keys: restoreKeys,
      preImage: preImage as unknown as Record<string, unknown>,
      written: writtenFeature as unknown as Record<string, unknown>,
      current: current as unknown as Record<string, unknown>,
    }) as Partial<FeatureInterface>;

    if (!Object.keys(restore).length) return;
    try {
      await updateFeature(context, current, restore, {
        casOnDateUpdated: current.dateUpdated,
        onStamped,
      });
      return;
    } catch (e) {
      if (e instanceof CasConflictError && attempt < maxAttempts) continue;
      throw e;
    }
  }
}

// Every check decidable without mutating belongs here, so the commit phase is
// left with only infra failures.
export async function collectPublishRevisionBlockers({
  context,
  feature,
  revision,
  result,
  comment,
  bypassLockdown,
  skipPrevalidateValidation,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  result: MergeResultChanges;
  comment?: string;
  bypassLockdown?: boolean;
  skipPrevalidateValidation?: boolean;
}): Promise<Error[]> {
  // Errors, not messages: SoftWarningError (422 + warnings) and BadRequestError
  // (400) reach the caller as themselves rather than a generic 500.
  const blockers: Error[] = [];
  const probe = async (check: () => Promise<void>) => {
    try {
      await check();
    } catch (e) {
      blockers.push(e instanceof Error ? e : new Error(getErrorMessage(e)));
    }
  };

  if (!bypassLockdown) {
    await probe(() => assertFeatureNotLockedByRamp(context, feature.id));
    await probe(async () => {
      if (
        revision.version !== undefined &&
        (await hasPublishLockingScheduledSibling(
          context.org.id,
          feature.id,
          revision.version,
        ))
      ) {
        throw new Error(
          "Another draft of this feature is scheduled to publish and has locked publishing of other drafts. Cancel that schedule to publish this revision.",
        );
      }
    });
  }

  await probe(() =>
    prevalidatePublishRevision({
      context,
      feature,
      revision,
      result,
      comment,
      skipValidation: skipPrevalidateValidation,
    }),
  );

  // Flattened to one error per message: this path throws instead of returning gates.
  const holdoutGates = await collectHoldoutChangeGates({
    context,
    feature,
    mergeResult: result,
    isRevert: !!revision.revertedFrom,
  });
  blockers.push(
    ...holdoutGates.flatMap((g) => g.messages.map((m) => new Error(m))),
  );

  return blockers;
}

// The bandit linkage a publish is about to imply, computed before anything is
// written. Reads the merge result as the rules about to go live, and drops the
// revision being published from the open drafts — it stops being a queued draft
// the moment it publishes.
async function planContextualBanditLinkageForPublish(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  result: MergeResultChanges,
) {
  const { openDrafts } = await getLinkageSyncRevisionSummaries(
    revision.organization,
    revision.featureId,
  );
  return planFeatureContextualBanditLinkage(
    context,
    revision.featureId,
    openDrafts.filter((d) => d.version !== revision.version),
    result.rules ?? feature.rules ?? [],
  );
}

// Named once because `featureDocumentWentBack` MATCHES on it. Two free-text copies
// meant a reword — an ordinary edit next to "ramp schedules" and "holdout linkage" —
// would silently make that match always true, recording every feature as rolled back
// and taking the durable-change event back out of service.
const FEATURE_DOC_REWIND = "feature document";

/**
 * Whether a failed publish left the feature DOCUMENT back at its pre-image, which is
 * what decides the fate of the `feature.updated` the apply deferred.
 *
 * A lost race is NOT "back": our write landed and the rival's followed it, so the
 * event is factually true, and suppressing it breaks the diff chain — consumers would
 * then receive the rival's event carrying `previous = our value`, which they were
 * never told about. The bulk path throws before it can record, so it already answers
 * this way; both surfaces have to answer it the same.
 */
export function featureDocumentWentBack({
  ownershipLost,
  unreversed,
}: {
  ownershipLost: boolean;
  /** Labels of the rewinds that could not be performed. */
  unreversed: string[];
}): boolean {
  if (ownershipLost) return false;
  return !unreversed.includes(FEATURE_DOC_REWIND);
}

export async function publishRevision({
  context,
  feature,
  revision,
  result,
  comment,
  bypassLockdown,
  skipPrevalidateValidation,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  result: MergeResultChanges;
  comment?: string;
  bypassLockdown?: boolean;
  // Set when this exact revision was already validated — as publish gates by the
  // REST handler, or immediately before insertion on the auto-publish paths.
  skipPrevalidateValidation?: boolean;
}) {
  // One deduped SDK refresh per landing (feature applies are multi-step: ramp
  // schedules, the feature document, holdout linkage), flushed on success and
  // compensation alike.
  return withBufferedPayloadRefreshes(context, "feature-publish", () =>
    publishRevisionInner({
      context,
      feature,
      revision,
      result,
      comment,
      bypassLockdown,
      skipPrevalidateValidation,
    }),
  );
}

async function publishRevisionInner({
  context,
  feature,
  revision,
  result,
  comment,
  bypassLockdown,
  skipPrevalidateValidation,
}: Parameters<typeof publishRevision>[0]) {
  if (revision.status === "published" || revision.status === "discarded") {
    throw new Error("Can only publish a draft revision");
  }

  // The authoritative landing gate, INSIDE the engine: evidence comes from the
  // merge result itself, so a caller cannot under-describe the change the way a
  // hand-built field list can. Callers that already asserted re-pass the same
  // inputs.
  // A landing that reaches the payload takes publish authority; one that is
  // entirely inert metadata is draft-class and skips the gate (the pre-split
  // semantic the features matrix pins for drafters editing descriptions).
  if (mergeResultTouchesPayload(result)) {
    await assertCanPublishFeatureRevision({
      context,
      feature,
      revision,
      environments: await getMergeResultPublishEnvs({
        context,
        feature,
        // The live feature's own rules are the baseline the merge lands on.
        filledLiveRules: feature.rules ?? [],
        result,
        environmentIds: getApplicableEnvIds(
          getEnvironments(context.org),
          feature,
        ),
        // The draft's ramp actions reach environments no rule diff mentions.
        rampActions: revision.rampActions,
      }),
      mergeChanges: result,
    });
  }

  // Before any mutation: applyRevisionChanges advances feature.version, so a
  // later throw would leave the feature live on a still-draft revision.
  const blockers = await collectPublishRevisionBlockers({
    context,
    feature,
    revision,
    result,
    comment,
    bypassLockdown,
    skipPrevalidateValidation,
  });
  if (blockers.length === 1) {
    throw blockers[0];
  }
  if (blockers.length > 1) {
    throw new Error(
      `This revision cannot be published:\n${blockers
        .map((b) => `• ${b.message}`)
        .join("\n")}`,
    );
  }

  const createActions = (revision.rampActions ?? []).filter(
    (a) => a.mode === "create",
  );
  const updateActions = (revision.rampActions ?? []).filter(
    (a) => a.mode === "update",
  );
  // `critical` = decides what is live (the feature document, then the revision
  // status). A satellite that can't be reversed must not abandon those.
  type Rewind = {
    what: string;
    undo: () => Promise<unknown>;
    critical?: boolean;
  };

  const rewinds: Rewind[] = [];
  let revisionStatusRewind: Rewind | null = null;

  let updatedFeature: FeatureInterface;
  // Our own write's stamp, captured the moment it lands: the ownership token the
  // unwind below checks before reversing any satellite.
  let ourWriteStamp: Date | undefined;
  try {
    // Inside the try, and registered BEFORE the creation runs. Creating several
    // schedules is several writes: a throw partway through has already created
    // some, and both the return value naming them and — while this sat outside
    // the try — the unwind that would remove them were lost with the throw. The
    // accumulator is written as each one lands, so the rewind names them whether
    // the call returns or throws. Still before the feature write, so a schedule
    // failure gates the publish.
    if (createActions.length) {
      const preCreatedScheduleIds: string[] = [];
      rewinds.push({
        what: "ramp schedules",
        undo: () =>
          Promise.all(
            preCreatedScheduleIds.map((id) =>
              context.models.rampSchedules.dangerousDeleteByIdBypassPermission(
                id,
              ),
            ),
          ),
      });
      await createRampSchedulesForRevision(
        context,
        feature,
        revision,
        result,
        createActions,
        preCreatedScheduleIds,
      );
    }

    // Captured before any mutation — the holdout transition is several
    // non-transactional writes, so a failure partway through has already mutated
    // linkage and must still be repaired.
    const holdoutPreImage =
      result.holdout === undefined
        ? null
        : await captureHoldoutLinkagePreImage(context, feature, result.holdout);

    // Publishing is the moment a bandit rule goes live, which is what
    // `linkedFeatures` tracks, and it retires the draft this revision was queued
    // as. Rules on either side matter: one adding a bandit rule links the
    // feature, one removing the last of them unlinks it.
    const contextualBanditLinkagePlan =
      referencesAnyContextualBandit(feature.rules) ||
      referencesAnyContextualBandit(result.rules)
        ? await planContextualBanditLinkageForPublish(
            context,
            feature,
            revision,
            result,
          )
        : null;

    // Not gated on the merge carrying a change: a publish with no delta is
    // exactly when state can be out of sync (reconciling a stranded revision).
    // Short-circuits when the feature has no holdout.
    const experimentLinkagePlans = await planHoldoutExperimentLinkage(
      context,
      feature,
      (result.holdout !== undefined
        ? result.holdout?.id
        : feature.holdout?.id) ?? null,
      result.rules ?? feature.rules ?? [],
    );

    // Captured BEFORE the apply, whose sync rewrites them — the same disposition the
    // sync itself computes, so the rewind restores exactly what this publish moved.
    const rolloutStatusMap = computeSafeRolloutStatusMap(feature, revision);
    const rolloutIds = Object.keys(rolloutStatusMap);
    const safeRolloutPreImages = rolloutIds.length
      ? (await context.models.safeRollout.getByIds(rolloutIds)).map((pre) => ({
          pre,
          writtenStatus: rolloutStatusMap[pre.id],
        }))
      : [];

    updatedFeature = await runGuardedWrite("feature", feature.id, () =>
      applyRevisionChanges(context, feature, revision, result, (stamp) => {
        // The stamp OUR write put on the doc. `updatedFeature.dateUpdated` comes
        // from a set-then-fetch, so a rival landing in that gap would hand us
        // THEIR stamp and compensation would read "still ours" at the one moment
        // it isn't — then reverse their linkage.
        ourWriteStamp = stamp;
      }),
    );

    // Safe-rollout statuses are rewritten inside the guarded apply above, and until
    // now nothing put them back if a LATER step failed — `updateSafeRolloutStatuses`
    // compensates its own failure, but a later `markRevisionAsPublished` failure left
    // rollouts started while the revision stayed unpublished. Same pre-images and the
    // same ownership-checked restore the bulk path uses.
    //
    // The POST-APPLY snapshot is taken here, right after the apply — not inside the
    // rewind. Read at unwind time it is whatever the document holds by then, so a
    // worker that advanced the rollout in between would be mistaken for the state
    // this publish wrote, and its progress reversed as ours. Bulk snapshots at the
    // same point for the same reason.
    const safeRolloutPostImages = safeRolloutPreImages.length
      ? await context.models.safeRollout.getByIds(
          safeRolloutPreImages.map(({ pre }) => pre.id),
        )
      : [];
    const safeRolloutPostById = new Map(
      safeRolloutPostImages.map((doc) => [doc.id, doc]),
    );
    if (safeRolloutPreImages.length) {
      rewinds.push({
        what: "safe rollout statuses",
        undo: async () => {
          for (const { pre, writtenStatus } of safeRolloutPreImages) {
            await context.models.safeRollout.restoreAfterFailedBulkPublish(
              pre,
              writtenStatus,
              safeRolloutPostById.get(pre.id),
            );
          }
        },
      });
    }

    rewinds.push({
      what: FEATURE_DOC_REWIND,
      critical: true,
      undo: async () => {
        // Paired with the rules restore: a reverted rule set must not leave the
        // experiments it added still pointing back at this feature.
        const addedExperiments = (
          updatedFeature.linkedExperiments ?? []
        ).filter((id) => !(feature.linkedExperiments ?? []).includes(id));
        for (const experimentId of addedExperiments) {
          await removeLinkedFeatureFromExperiment(
            context,
            experimentId,
            feature.id,
          );
        }
        await restorePublishedFeatureDoc(
          context,
          feature,
          revision,
          result,
          updatedFeature,
        );
      },
    });

    if (result.holdout !== undefined) {
      if (holdoutPreImage) {
        rewinds.push({
          what: "holdout linkage",
          undo: () => rewindHoldoutLinkage(context, holdoutPreImage),
        });
      }

      // Guard already ran above, before any mutation.
      await applyHoldoutSideEffects(context, feature, result.holdout, {
        skipGuard: true,
      });
    }

    // One chain across the whole sequence: a leave plan and a join plan can name the
    // same experiment, and the second must expect what the first wrote.
    const linkageChain: Record<string, string> = {};
    for (const plan of experimentLinkagePlans) {
      rewinds.push({
        what: `holdout experiment linkage (${plan.holdoutId})`,
        undo: () => reverseHoldoutExperimentLinkage(context, plan),
      });
      await applyHoldoutExperimentLinkage(context, plan, linkageChain);
    }

    if (contextualBanditLinkagePlan) {
      rewinds.push({
        what: "contextual bandit linkage",
        undo: () =>
          reverseFeatureContextualBanditLinkage(
            context,
            contextualBanditLinkagePlan,
          ),
      });
      await applyFeatureContextualBanditLinkage(
        context,
        contextualBanditLinkagePlan,
        { guarded: true },
      );
    }

    // RE-FENCE, like the bulk path. The guarded document write proves nothing about
    // the moment of each satellite write, and holdout membership cannot carry a guard
    // of its own — its condition lives in another collection. If a rival took the
    // document while we were writing, our satellite state is stale: fail here so the
    // rewinds below run, rather than committing a publish on top of it.
    if (ourWriteStamp) {
      const afterSatellites = await getFeature(context, feature.id);
      if (afterSatellites?.dateUpdated?.getTime() !== ourWriteStamp.getTime()) {
        throw new CasConflictError();
      }
    }

    const publishStamp = await markRevisionAsPublished(
      context,
      feature,
      revision,
      context.auditUser,
      comment,
    );
    revisionStatusRewind = {
      what: "revision status",
      critical: true,
      undo: async () => {
        const reopened = await restoreFeatureRevisionAfterFailedBulkPublish(
          revision,
          publishStamp,
        );
        if (!reopened) {
          throw new Error("revision was re-published concurrently");
        }
      },
    };
  } catch (err) {
    // Leave-whole: on the first failed step, stop — a doc reverted beside a
    // satellite that stayed published is a worse shape than a publish that
    // stands. Reopening the revision goes last, so it is never a draft while
    // the feature doc it advanced stays published.
    const unwind = [...rewinds].reverse();
    if (revisionStatusRewind) unwind.push(revisionStatusRewind);
    // OWNERSHIP FIRST, before any satellite is reversed. Only the doc restore is
    // guarded; the holdout, experiment-linkage and bandit rewinds are not — run
    // after a rival publish took the feature, they would undo ITS satellites
    // while the doc restore correctly declined, leaving live with the rival's
    // rules and our pre-image's satellites. Our own write's stamp is the token:
    // if live has moved past it, reverse NOTHING and report the residue. Same
    // rule bulk applies. No stamp means the feature write never landed, so there
    // is nothing of ours to reverse either.
    let ownershipLost = false;
    const ourStamp = ourWriteStamp;
    if (ourStamp) {
      const live = await getFeature(context, feature.id);
      ownershipLost =
        !live || live.dateUpdated?.getTime() !== ourStamp.getTime();
    }
    let criticalFailed = false;
    const unreversed: string[] = [];
    if (ownershipLost) {
      logger.error(
        `A later write owns feature ${feature.id}; leaving its document and revision status alone and taking back only this publish's satellite writes`,
      );
    }
    for (const rewind of unwind) {
      const { what, undo, critical } = rewind;
      // A rival owns the DOCUMENT, not our satellite writes. Restoring the document
      // would overwrite their publish, and reopening the revision would contradict a
      // still-published feature — but leaving our holdout, experiment-linkage and
      // bandit writes in place strands stale state on top of theirs. Each of those
      // reversals is ownership-aware and declines whatever a different owner now
      // holds, so running them takes back exactly what is still ours.
      if (
        ownershipLost &&
        (what === FEATURE_DOC_REWIND || rewind === revisionStatusRewind)
      ) {
        unreversed.push(what);
        continue;
      }
      if (criticalFailed) {
        logger.error(
          `Skipping rewind of ${what} for feature ${feature.id} revision ${revision.version}: an earlier critical step could not be reversed`,
        );
        unreversed.push(what);
        continue;
      }
      try {
        await undo();
      } catch (rewindErr) {
        if (critical) criticalFailed = true;
        unreversed.push(what);
        logger.error(
          rewindErr,
          `Failed to rewind ${what} for feature ${feature.id} revision ${revision.version} after a failed publish${critical ? " — the feature stays at the published state" : " (satellite; continuing)"}`,
        );
      }
    }
    // Report whether the feature DOCUMENT went back, which is what decides its
    // deferred `feature.updated`. This path compensates through its own rewinds rather
    // than the shared restore funnel, so without this the set stayed empty on the one
    // landing that actually produces late producers.
    //
    // A lost race is NOT "back": our write landed and the rival's followed it, so the
    // event is factually true and suppressing it breaks the diff chain — consumers
    // would then receive the rival's event carrying `previous = our value`, a value
    // they were never told about. The bulk path throws before it can record, so it
    // already answers this way; both surfaces have to answer it the same.
    if (featureDocumentWentBack({ ownershipLost, unreversed })) {
      context.bulkPublishRestoredEntities?.add(
        entityKey("feature", feature.id),
      );
    }
    // Say so in the response: continuing past a satellite keeps the feature and
    // its revision consistent, but whatever could not be reversed is left behind
    // and the caller is the only one positioned to act on it.
    if (unreversed.length) {
      // Same reason as the direct path: what could not be reversed is live, so the
      // buffered update events must not be dropped as if nothing happened.
      context.landingLeftPartialState = true;
      const residue = `(could not be rolled back: ${unreversed.join(", ")} — see server logs)`;
      // Appending keeps the original error's class, and so its status code.
      if (err instanceof Error) {
        err.message += ` ${residue}`;
        throw err;
      }
      throw new Error(`${getErrorMessage(err)} ${residue}`);
    }
    throw err;
  }

  // The publish is committed once the revision is marked published, so this
  // sweep must not be able to unwind it.
  try {
    await clearPendingFeatureDraftsForRevision(
      context,
      revision.featureId,
      revision.version,
      revision.rules,
    );
  } catch (err) {
    logger.error(
      err,
      `Failed to clear pending feature drafts for feature ${feature.id} revision ${revision.version} after publish`,
    );
  }

  // Apply deferred update actions after publish succeeds.
  // Best-effort: errors are logged but do not fail the publish response
  // (feature is already committed; a failed schedule update is recoverable).
  if (updateActions.length) {
    try {
      await createRampSchedulesForRevision(
        context,
        updatedFeature,
        revision,
        result,
        updateActions,
      );
    } catch (err) {
      logger.error(
        err,
        "Failed to apply deferred ramp update actions after publish",
      );
    }
  }

  // Apply detach actions (best-effort: logged but do not fail publish).
  if (revision.rampActions?.length) {
    await applyDetachRampActions(context, revision.rampActions);
  }

  // Clean up orphaned ramp schedules (best-effort).
  await cleanupOrphanedRampSchedules(context, feature, updatedFeature);

  return updatedFeature;
}

// Create a new revision from the given changes and immediately publish it.
// Either the revision is published and the updated feature is returned, or an
// error is thrown — a pending-review draft is never silently left behind.
// canBypassApprovalChecks should be true when the org-level restApiBypassesReviews
// setting is on, or when the caller's role/token grants FlagsBypassApprovals
// on the feature's project.
export async function createAndPublishRevision({
  context,
  feature,
  user,
  org,
  changes,
  comment,
  canBypassApprovalChecks,
  revertedFrom,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  user: EventUser;
  org: OrganizationInterface;
  changes: Parameters<typeof createRevision>[0]["changes"];
  comment?: string;
  canBypassApprovalChecks: boolean;
  revertedFrom?: number;
}): Promise<{
  revision: FeatureRevisionInterface;
  updatedFeature: FeatureInterface;
  /** True when a live approval requirement was stepped over, for the caller to report. */
  bypassedApproval: boolean;
}> {
  // Filter to envs applicable to this feature's project — avoids over-
  // triggering approval and creating dangling per-env settings.
  const orgEnvironments = getEnvironmentIdsFromOrg(org);
  const orgEnvObjects = getEnvironments(org);
  const applicableEnvIds = getApplicableEnvIds(orgEnvObjects, feature);
  const applicableEnvSet = new Set(applicableEnvIds);
  const allEnvironments = orgEnvironments.filter((e) =>
    applicableEnvSet.has(e),
  );

  const liveBase = await getLiveBaselineRevision(context, feature);
  const { revision: preparedRevision } = await prepareFeatureRevision({
    context,
    feature,
    user,
    environments: allEnvironments,
    baseVersion: feature.version,
    changes,
    revertedFrom,
    comment: comment ?? "Created via REST API",
  });
  const requiresReview = checkIfRevisionNeedsReview({
    feature,
    baseRevision: liveBase,
    revision: preparedRevision,
    allEnvironments,
    settings: org.settings,
    requireApprovalsLicensed: context.hasPremiumFeature("require-approvals"),
  });

  if (requiresReview && !canBypassApprovalChecks) {
    throw new PermissionError(
      "This feature requires approval before changes can be published. " +
        "Enable 'REST API always bypasses approval requirements' in organization settings.",
    );
  }

  const mergeForPublish = (revision: FeatureRevisionInterface) => {
    const result = autoMerge(liveBase, liveBase, revision, allEnvironments, {});
    if (!result.success) {
      throw new Error(
        "Merge conflict detected while publishing revision. Please retry.",
      );
    }
    return result.result;
  };

  // Create the draft revision (never auto-publishes; publish=false).
  const revision = await createRevision({
    context,
    feature,
    user,
    baseVersion: feature.version,
    comment: comment ?? "Created via REST API",
    environments: allEnvironments,
    publish: false,
    changes,
    org,
    canBypassApprovalChecks,
    revertedFrom,
    preInsertValidation: async (revision) => {
      await prevalidatePublishRevision({
        context,
        feature,
        revision,
        result: mergeForPublish(revision),
        comment,
      });
    },
  });

  const updatedFeature = await publishRevision({
    context,
    feature,
    revision,
    result: mergeForPublish(revision),
    comment,
    // See postFeatureRevisionPublish.ts for the bypassLockdown policy rationale:
    // approval-bypass permission intentionally doubles as ramp-lockdown bypass.
    bypassLockdown: canBypassApprovalChecks,
    skipPrevalidateValidation: true,
  });

  // `bypassedApproval` lets callers report the gate they skipped. Every other publish
  // surface names its bypasses in the response; the paths that land through here were
  // silent about it, so a caller could not tell a publish that needed no approval from
  // one that stepped over a live requirement.
  return { revision, updatedFeature, bypassedApproval: requiresReview };
}

function getLinkedExperiments(feature: FeatureInterface) {
  // Keep existing links even when a rule is removed — past revisions need
  // them to render correctly.
  const expIds: Set<string> = new Set(feature.linkedExperiments || []);

  (feature.rules ?? []).forEach((rule) => {
    if (rule?.type === "experiment-ref") {
      expIds.add(rule.experimentId);
    }
  });

  return [...expIds];
}

export async function toggleNeverStale(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  neverStale: boolean,
) {
  return await updateFeature(context, feature, { neverStale });
}

export async function hasNonDemoFeature(context: ReqContext | ApiReqContext) {
  const demoProjectId = getDemoDatasourceProjectIdForOrganization(
    context.org.id,
  );
  const feature = await FeatureModel.findOne(
    {
      organization: context.org.id,
      project: { $ne: demoProjectId },
    },
    { _id: 1 },
  );
  return !!feature;
}

export async function getFeatureMetaInfoById(
  context: ReqContext | ApiReqContext,
  opts: {
    includeDefaultValue?: boolean;
    project?: string;
    ids?: string[];
  } = {},
): Promise<FeatureMetaInfo[]> {
  const { includeDefaultValue = false, project, ids } = opts;

  const query: Record<string, unknown> = { organization: context.org.id };
  if (project) {
    Object.assign(query, targetingScopedProjectClause([project]));
  }
  if (ids?.length) {
    query.id = { $in: ids };
  }

  const projection: Record<string, number> = {
    id: 1,
    project: 1,
    targetingAllProjects: 1,
    targetingProjects: 1,
    archived: 1,
    description: 1,
    dateCreated: 1,
    dateUpdated: 1,
    tags: 1,
    owner: 1,
    valueType: 1,
    version: 1,
    linkedExperiments: 1,
    neverStale: 1,
    "jsonSchema.enabled": 1,
    revision: 1,
    prerequisites: 1,
    "rules.prerequisites": 1,
    "rules.savedGroups": 1,
    environmentSettings: 1,
    // `baseConfig` drives the list's "Config · <name>" type display; the full
    // (potentially large) default value is fetched only when the caller asks for
    // it — the list itself never parses it.
    baseConfig: 1,
    ...(includeDefaultValue ? { defaultValue: 1 } : {}),
  };

  const features = await FeatureModel.find(query, projection);

  return features
    .filter((f) => context.permissions.canReadTargetingScopedResource(f))
    .map((f) => {
      const doc = f as unknown as Record<string, unknown>;
      const rules = doc.rules as
        | { prerequisites?: unknown[]; savedGroups?: unknown[] }[]
        | undefined;
      const envSettings = doc.environmentSettings as
        | Record<string, { prerequisites?: unknown[] }>
        | undefined;
      const topPrereqs = doc.prerequisites as unknown[] | undefined;

      const hasPrerequisites =
        (topPrereqs?.length ?? 0) > 0 ||
        (rules ?? []).some((r) => (r.prerequisites?.length ?? 0) > 0) ||
        Object.values(envSettings ?? {}).some(
          (e) => (e.prerequisites?.length ?? 0) > 0,
        );

      const hasSavedGroups = (rules ?? []).some(
        (r) => (r.savedGroups?.length ?? 0) > 0,
      );

      // The list shows "Config · <name>" from the flag's first-class `baseConfig`
      // (authoritative), not by parsing the default value.
      const configBackingKey = f.baseConfig ?? null;

      return {
        id: f.id,
        project: f.project,
        archived: f.archived,
        description: f.description,
        dateCreated: f.dateCreated,
        dateUpdated: f.dateUpdated,
        tags: f.tags,
        owner: f.owner,
        valueType: f.valueType,
        version: f.version,
        linkedExperiments: f.linkedExperiments,
        neverStale: f.neverStale,
        hasPrerequisites,
        hasSavedGroups,
        configBackingKey,
        revision: f.revision as FeatureMetaInfo["revision"],
        ...(includeDefaultValue && { defaultValue: f.defaultValue ?? "" }),
      };
    });
}

export async function getFeatureMetaInfoByIds(
  context: ReqContext | ApiReqContext,
  ids: string[],
): Promise<FeatureMetaInfo[]> {
  if (!ids.length) return [];

  const features = await FeatureModel.find(
    { organization: context.org.id, id: { $in: ids } },
    {
      id: 1,
      project: 1,
      targetingAllProjects: 1,
      targetingProjects: 1,
      archived: 1,
      description: 1,
      dateCreated: 1,
      dateUpdated: 1,
      tags: 1,
      owner: 1,
      valueType: 1,
      version: 1,
      linkedExperiments: 1,
      neverStale: 1,
      "jsonSchema.enabled": 1,
      revision: 1,
    },
  );

  return features
    .filter((f) => context.permissions.canReadTargetingScopedResource(f))
    .map((f) => ({
      id: f.id,
      project: f.project,
      archived: f.archived,
      description: f.description,
      dateCreated: f.dateCreated,
      dateUpdated: f.dateUpdated,
      tags: f.tags,
      owner: f.owner,
      valueType: f.valueType,
      version: f.version,
      linkedExperiments: f.linkedExperiments,
      neverStale: f.neverStale,
      revision: f.revision as FeatureMetaInfo["revision"],
    }));
}

export async function getFeatureEnvStatus(
  context: ReqContext | ApiReqContext,
  ids?: string[],
): Promise<
  { id: string; environmentSettings: FeatureInterface["environmentSettings"] }[]
> {
  const q: FilterQuery<FeatureDocument> = { organization: context.org.id };
  if (ids && ids.length > 0) {
    q.id = { $in: ids };
  }

  // Push project-level read restrictions into the query to avoid fetching
  // documents that will be filtered out anyway.
  const allowedProjects =
    context.permissions.getProjectsWithPermission("readData");
  if (allowedProjects !== null) {
    if (allowedProjects.length === 0) return [];
    // Also include features with no project — they're globally accessible
    q.$or = [
      { project: { $in: allowedProjects } },
      { project: { $in: ["", null] } },
    ];
  }

  const docs = await FeatureModel.find(q, {
    id: 1,
    environmentSettings: 1,
  });

  return docs.map((f) => ({
    id: f.id as string,
    // This getter only reads `enabled`, so v1 vs v2 env shape doesn't matter.
    environmentSettings: applyEnvironmentInheritance(
      context.org.settings?.environments || [],
      f.environmentSettings || {},
    ) as FeatureInterface["environmentSettings"],
  }));
}
