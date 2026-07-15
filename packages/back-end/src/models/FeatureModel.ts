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
  stemRuleId,
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
  generateRuleId,
  addIdsToFlatRules,
  getApiFeatureObj,
  getNextScheduledUpdate,
  getSavedGroupMap,
  queueSDKPayloadRefresh,
  synthesizeRuleId,
} from "back-end/src/services/features";
import {
  assertConfigBackedDefaultHasNoOverrides,
  assertConfigBackedFeatureValuesValid,
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
  upgradeFeatureRule,
  upgradeV0Feature,
} from "back-end/src/util/migrations";
import {
  ensureUniqueRuleIds,
  flattenV1ToV2Rules,
  getApplicableEnvIds,
  isPlausibleFeatureRule,
  V1RulesByEnv,
} from "back-end/src/util/flattenRules";
import { ReqContext } from "back-end/types/request";
import {
  applyEnvironmentInheritance,
  buildInheritedChildrenByAncestor,
  expandRuleEnvsForInheritance,
  getAffectedSDKPayloadKeys,
  getSDKPayloadKeysByDiff,
} from "back-end/src/util/features";
import { applyPartialFeatureRuleUpdatesToRevision } from "back-end/src/util/featureRevision.util";
import { NotFoundError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import {
  getContextForAgendaJobByOrgId,
  getEnvironmentIdsFromOrg,
} from "back-end/src/services/organizations";
import { getEnvironments } from "back-end/src/util/organization.util";
import { ApiReqContext } from "back-end/types/api";
import { deriveLiveFeatureEventEnvironments } from "back-end/src/events/eventEnvironments";
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
  getRevision,
  hasPublishLockingScheduledSibling,
  markRevisionAsPublished,
  computeRevisionPublishChanges,
  updateRevision,
  createRevision,
} from "./FeatureRevisionModel";

const featureSchema = new mongoose.Schema({
  id: String,
  archived: Boolean,
  description: String,
  organization: String,
  nextScheduledUpdate: Date,
  owner: String,
  project: String,
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

type FeatureDocument = mongoose.Document & LegacyFeatureInterface;

export const FeatureModel = mongoose.model<LegacyFeatureInterface>(
  "Feature",
  featureSchema,
);

/**
 * JIT-migration chokepoint for features on read. Discriminates v0 / v1 / v2
 * (see `shared/types/feature.d.ts`) and normalizes to v2. Any residual
 * `env.rules` is scrubbed in-memory so the return value matches `featureEnvironment`.
 *
 * v2 docs MUST NOT flow through `upgradeV0Feature` — it redistributes top-level
 * rules back into per-env arrays and corrupts v2 data.
 *
 * Pure over `(raw, context)` so it's unit-testable without a live DB.
 */
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
  if (projects && projects.length === 1) {
    q.project = projects[0];
  } else if (projects && projects.length > 1) {
    q.project = { $in: projects };
  }

  if (!includeArchived) {
    q.archived = { $ne: true };
  }

  const features = (await FeatureModel.find(q)).map((m) =>
    toInterface(m, context),
  );

  return features.filter((feature) =>
    context.permissions.canReadSingleProjectResource(feature.project),
  );
}

/**
 * Lightweight sibling of {@link getAllFeatures} for the stale-detection and
 * dependents graph. Skips Mongoose hydration via `.lean()` and projects out
 * heavy fields the graph does not read. Same migration + permission filter as
 * `getAllFeatures`, so results are interchangeable for any caller that only
 * needs the dependency graph.
 *
 * NOTE: the return type is `FeatureInterface[]`, but the projected-out fields
 * (`description` / `jsonSchema` / `customFields` / legacy `draft`) will be
 * absent at runtime. Only use this for graph/stale callers that don't read
 * those fields — reach for `getAllFeatures` if you need a complete feature.
 */
export async function getAllFeaturesForStaleGraph(
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

  return features.filter((feature) =>
    context.permissions.canReadSingleProjectResource(feature.project),
  );
}

function featureListQuery(
  orgId: string,
  opts: { project?: string; projectIds?: string[]; includeArchived?: boolean },
): FilterQuery<FeatureDocument> {
  const { project, projectIds, includeArchived = false } = opts;
  return {
    organization: orgId,
    ...(project != null
      ? { project }
      : projectIds != null
        ? { project: { $in: projectIds } }
        : {}),
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
      context.permissions.canReadSingleProjectResource(feature.project),
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

  return context.permissions.canReadSingleProjectResource(feature.project)
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
    context.permissions.canReadSingleProjectResource(feature.project),
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

  // A config-backed default must be exactly a config. Enforced at this shared
  // create choke point so every entry point is covered, not just REST handlers.
  assertConfigBackedDefaultHasNoOverrides(
    featureToCreate,
    featureToCreate.defaultValue,
  );

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

  onFeatureDelete(context, feature).catch((e) => {
    logger.error(e, "Error refreshing SDK Payload on feature delete");
  });
}

/**
 * Deletes all features belonging to a project
 * @param projectId
 * @param organization
 */
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
        projects: [currentApiFeature.project],
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
        new Set([previousApiFeature.project, currentApiFeature.project]),
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
  queueSDKPayloadRefresh({
    context,
    payloadKeys: getAffectedSDKPayloadKeys(
      [feature],
      getEnvironmentIdsFromOrg(context.org),
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
  queueSDKPayloadRefresh({
    context,
    payloadKeys: getAffectedSDKPayloadKeys(
      [feature],
      getEnvironmentIdsFromOrg(context.org),
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
  queueSDKPayloadRefresh({
    context,
    payloadKeys: getSDKPayloadKeysByDiff(
      feature,
      updatedFeature,
      getEnvironmentIdsFromOrg(context.org),
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
    // Event-based webhooks
    await logFeatureUpdatedEvent(context, feature, updatedFeature);
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
): Promise<FeatureInterface> {
  const allUpdates = {
    ...updates,
    dateUpdated: new Date(),
  };
  // Used only for hooks and linkedExperiment derivation; the post-write
  // value is re-read from Mongo below.
  const projected = {
    ...feature,
    ...allUpdates,
  };

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

  await runValidateFeatureHooks({
    context,
    feature: projected,
    original: feature,
  });

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

  await FeatureModel.updateOne(
    { organization: feature.organization, id: feature.id },
    {
      $set: normalizedUpdates,
    },
  );

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
  if (!rule.id) {
    rule.id = generateRuleId();
  }
  if (rule.type === "rollout" && !rule.seed) {
    rule.seed = rule.id;
  }

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

const updateSafeRolloutStatuses = async (
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
) => {
  if (!revision.rules || revision.rules.length === 0) return;

  const safeRolloutStatusesMap: Record<
    string,
    { status: "running" | "rolled-back" | "released" | "stopped" }
  > = Object.fromEntries(
    revision.rules
      .filter((rule): rule is SafeRolloutRule => rule?.type === "safe-rollout")
      .map((rule) => [rule.safeRolloutId, { status: rule.status }]),
  );
  // Stop safe rollouts whose rule was removed in this revision.
  (feature.rules ?? []).forEach((rule) => {
    if (
      rule?.type === "safe-rollout" &&
      !safeRolloutStatusesMap[rule.safeRolloutId]
    ) {
      safeRolloutStatusesMap[rule.safeRolloutId] = { status: "stopped" };
    }
  });

  const safeRollouts = await context.models.safeRollout.getByIds(
    Object.keys(safeRolloutStatusesMap),
  );

  safeRollouts.forEach((safeRollout) => {
    // sync the status of the safe rollout to the status of the revision
    const safeRolloutUpdates: UpdateProps<SafeRolloutInterface> = {
      status: safeRolloutStatusesMap[safeRollout.id].status,
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

    context.models.safeRollout.update(safeRollout, safeRolloutUpdates);
  });
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
    // Ensure every rollout rule that's being published has a seed — required
    // for ramp-monitored payload stability. Rules created before the
    // seed-backfill was introduced (or attached to a ramp for the first time)
    // get seed = rule.id here so they match the SDK's featureId fallback.
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
) {
  const { changes, hasChanges, removeHoldout } = computeRevisionMergeChanges(
    context,
    feature,
    revision,
    result,
  );

  if (!hasChanges) {
    return await updateFeature(context, feature, changes);
  }

  await updateSafeRolloutStatuses(context, feature, revision);

  // Handle holdout removal separately since updateFeature only does $set
  if (removeHoldout) {
    await removeHoldoutFromFeature(context, feature);
    // Remove holdout from the feature object so the returned feature is correct
    const { holdout: _, ...featureWithoutHoldout } = feature;
    return await updateFeature(
      context,
      featureWithoutHoldout as FeatureInterface,
      changes,
    );
  }

  return await updateFeature(context, feature, changes);
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
) {
  const prevHoldoutId = feature.holdout?.id;
  const newHoldoutId = newHoldout?.id;

  if (newHoldoutId === prevHoldoutId) return;

  // Guard: cannot change holdout when there are running experiments, bandits, or safe rollouts
  if (newHoldout !== null) {
    const experiments = await Promise.all(
      (feature.linkedExperiments ?? []).map((id) =>
        getExperimentById(context, id),
      ),
    );
    const hasNonDraftExperiments = experiments.some(
      (exp) => exp?.status !== "draft",
    );
    const hasBandits = experiments.some(
      (exp) => exp?.type === "multi-armed-bandit",
    );
    const hasSafeRollouts = (feature.rules ?? []).some(
      (rule) => rule?.type === "safe-rollout",
    );
    if (hasNonDraftExperiments || hasBandits || hasSafeRollouts) {
      throw new Error(
        "Cannot change holdout when there are running linked experiments, safe rollout rules, or multi-armed bandit rules",
      );
    }
  }

  // Remove feature from the old holdout
  if (prevHoldoutId) {
    await context.models.holdout.removeFeatureFromHoldout(
      prevHoldoutId,
      feature.id,
    );
  }

  // Link feature (and its experiments) to the new holdout
  if (newHoldoutId) {
    const holdoutObj = await context.models.holdout.getById(newHoldoutId);
    if (!holdoutObj) {
      throw new Error("Holdout not found");
    }

    await context.models.holdout.updateById(newHoldoutId, {
      linkedFeatures: {
        [feature.id]: { id: feature.id, dateAdded: new Date() },
        ...holdoutObj.linkedFeatures,
      },
      ...(feature.linkedExperiments?.length
        ? {
            linkedExperiments: {
              ...Object.fromEntries(
                feature.linkedExperiments.map((experimentId) => [
                  experimentId,
                  { id: experimentId, dateAdded: new Date() },
                ]),
              ),
              ...holdoutObj.linkedExperiments,
            },
          }
        : {}),
    });

    if (feature.linkedExperiments?.length) {
      const linkedExperiments = await Promise.all(
        feature.linkedExperiments.map((eid) => getExperimentById(context, eid)),
      );
      await Promise.all(
        linkedExperiments.map(async (exp) => {
          if (!exp) return;
          return updateExperiment({
            context,
            experiment: exp,
            changes: { holdoutId: newHoldoutId },
          });
        }),
      );
    }
  }
}

// Apply deferred ramp create/update actions stored on a revision.
// - `create` actions are called BEFORE feature write so schedule creation
//   failures abort publish.
// - `update` actions are called AFTER publish succeeds (best-effort).
// Returns only newly created schedule IDs (for rollback on failure).
async function createRampSchedulesForRevision(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: { version: number },
  result: MergeResultChanges,
  actions: RevisionRampAction[],
): Promise<string[]> {
  const createdIds: string[] = [];

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
    // "Start now": user explicitly cleared startDate on a not-yet-started
    // schedule. Transition ready → running inline so the rule goes live on
    // publish instead of at the next poller tick. A ready schedule has all
    // fields editable (startActions included — the ramp hasn't fired), so no
    // running-merge / paused-clamp handling is needed here.
    let startDeferredToScheduler = false;
    if (
      updateAction.startDate === null &&
      existingSchedule?.status === "ready"
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
          await context.models.rampSchedules.deleteById(existing.id);
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
        await context.models?.rampSchedules?.deleteById?.(ramp.id);
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

// Best-effort early hook run; updateFeature / markRevisionAsPublished re-run hooks authoritatively
export async function prevalidatePublishRevision({
  context,
  feature,
  revision,
  result,
  comment,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  result: MergeResultChanges;
  comment?: string;
}) {
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
  // Re-check the value going live: a config-backed default must be exactly a
  // config. This shared publish choke point can't be circumvented by publishing
  // a stale/crafted draft outside the REST layer.
  assertConfigBackedDefaultHasNoOverrides(
    proposedFeature,
    proposedFeature.defaultValue,
  );
  // Re-validate every config-backed value going live against the backing
  // config's schema + invariants (env-agnostic AND per-environment flavor
  // shape). Save-time validation can be stale: a config's schema/invariants may
  // tighten between drafting and publish. This shared choke point closes that
  // gap for every publish path — including auto-publish (experiment/bandit
  // start) and postFeatureSync, which don't pass through the REST publish
  // handler's own net.
  await assertConfigBackedFeatureValuesValid(context, proposedFeature, {
    defaultValue: proposedFeature.defaultValue,
    rules: proposedFeature.rules,
  });
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

export async function publishRevision({
  context,
  feature,
  revision,
  result,
  comment,
  bypassLockdown,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  result: MergeResultChanges;
  comment?: string;
  bypassLockdown?: boolean;
}) {
  if (revision.status === "published" || revision.status === "discarded") {
    throw new Error("Can only publish a draft revision");
  }

  if (!bypassLockdown) {
    await assertFeatureNotLockedByRamp(context, feature.id);

    // A sibling draft's "lock other drafts" schedule freezes other publishes.
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
  }

  // Run custom hooks before the side-effect writes below so a rejection doesn't orphan them
  await prevalidatePublishRevision({
    context,
    feature,
    revision,
    result,
    comment,
  });

  // Create ramp schedules BEFORE writing the feature so that a schedule
  // creation failure gates the publish (atomicity: no published feature without
  // its ramp schedule).
  const createActions = (revision.rampActions ?? []).filter(
    (a) => a.mode === "create",
  );
  const updateActions = (revision.rampActions ?? []).filter(
    (a) => a.mode === "update",
  );
  const preCreatedScheduleIds: string[] = [];
  if (createActions.length) {
    const ids = await createRampSchedulesForRevision(
      context,
      feature,
      revision,
      result,
      createActions,
    );
    preCreatedScheduleIds.push(...ids);
  }

  let updatedFeature: FeatureInterface;
  try {
    updatedFeature = await applyRevisionChanges(
      context,
      feature,
      revision,
      result,
    );

    if (result.holdout !== undefined) {
      await applyHoldoutSideEffects(context, feature, result.holdout);
    }

    await markRevisionAsPublished(
      context,
      feature,
      revision,
      context.auditUser,
      comment,
    );

    await clearPendingFeatureDraftsForRevision(
      context,
      revision.featureId,
      revision.version,
      revision.rules,
    );
  } catch (err) {
    // Roll back pre-created ramp schedules so they don't linger as orphans.
    for (const id of preCreatedScheduleIds) {
      try {
        await context.models.rampSchedules.deleteById(id);
      } catch (deleteErr) {
        logger.error(
          deleteErr,
          `Failed to delete orphaned ramp schedule ${id} during publish rollback`,
        );
      }
    }
    throw err;
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
// setting is on, or when the caller's role/token grants bypassApprovalChecks
// on the feature's project.
export async function createAndPublishRevision({
  context,
  feature,
  user,
  org,
  changes,
  comment,
  canBypassApprovalChecks,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  user: EventUser;
  org: OrganizationInterface;
  changes: Parameters<typeof createRevision>[0]["changes"];
  comment?: string;
  canBypassApprovalChecks: boolean;
}): Promise<{
  revision: FeatureRevisionInterface;
  updatedFeature: FeatureInterface;
}> {
  // Filter to envs applicable to this feature's project — avoids over-
  // triggering approval and creating dangling per-env settings.
  const orgEnvironments = getEnvironmentIdsFromOrg(org);
  const orgEnvObjects = getEnvironments(org);
  const applicableEnvIds = getApplicableEnvIds(orgEnvObjects, feature.project);
  const applicableEnvSet = new Set(applicableEnvIds);
  const allEnvironments = orgEnvironments.filter((e) =>
    applicableEnvSet.has(e),
  );

  // Determine whether the revision would require review before we create anything.
  // We need a synthetic revision to check against, mirroring what createRevision would build.
  const liveRevision = await getRevision({
    context,
    organization: feature.organization,
    featureId: feature.id,
    feature,
    version: feature.version,
  });
  if (!liveRevision) throw new Error("Could not load live revision");

  // Live baseline for the review check and the publish merge, built from the
  // feature document (the canonical live state). Stored revision docs can be
  // sparse or in legacy shapes, so they're not a reliable baseline.
  const liveBase: FeatureRevisionInterface = {
    ...liveRevision,
    ...liveRevisionFromFeature(liveRevision, feature),
  } as FeatureRevisionInterface;

  // Synthetic revision for the review check; caller-supplied rules replace
  // the live array wholesale (same as autoMerge).
  const syntheticRevision: FeatureRevisionInterface = {
    ...liveBase,
    ...(changes ?? {}),
    rules: changes?.rules ?? liveBase.rules ?? [],
  };
  const requiresReview = checkIfRevisionNeedsReview({
    feature,
    baseRevision: liveBase,
    revision: syntheticRevision,
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
  });

  // Merge the new revision against the live-feature baseline. base === live
  // for a fresh revision off HEAD.
  const mergeResult = autoMerge(
    liveBase,
    liveBase,
    revision,
    allEnvironments,
    {},
  );

  if (!mergeResult.success) {
    // Shouldn't happen for a brand-new revision off HEAD, but guard anyway.
    throw new Error(
      "Merge conflict detected while publishing revision. Please retry.",
    );
  }

  const updatedFeature = await publishRevision({
    context,
    feature,
    revision,
    result: mergeResult.result,
    comment,
    // See postFeatureRevisionPublish.ts for the bypassLockdown policy rationale:
    // approval-bypass permission intentionally doubles as ramp-lockdown bypass.
    bypassLockdown: canBypassApprovalChecks,
  });

  return { revision, updatedFeature };
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
    query.project = project;
  }
  if (ids?.length) {
    query.id = { $in: ids };
  }

  const projection: Record<string, number> = {
    id: 1,
    project: 1,
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
    .filter((f) => context.permissions.canReadSingleProjectResource(f.project))
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
    .filter((f) => context.permissions.canReadSingleProjectResource(f.project))
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
