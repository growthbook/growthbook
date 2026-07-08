import omit from "lodash/omit";
import cloneDeep from "lodash/cloneDeep";
import isEqual from "lodash/isEqual";
import { UpdateFilter } from "mongodb";
import { featureInterface, simpleSchemaValidator } from "shared/validators";
import { CreateProps, UpdateProps } from "shared/types/base-model";
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
import { ResourceEvents } from "shared/types/events/base-types";
import { DiffResult } from "shared/types/events/diff";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import {
  getApiFeatureObj,
  getSavedGroupMap,
  queueSDKPayloadRefresh,
  synthesizeRuleId,
} from "back-end/src/services/features";
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
  getLinkedExperiments,
  getSDKPayloadKeysByDiff,
} from "back-end/src/util/features";
import { logger } from "back-end/src/util/logger";
import {
  getContextForAgendaJobByOrgId,
  getEnvironmentIdsFromOrg,
} from "back-end/src/services/organizations";
import { getEnvironments } from "back-end/src/util/organization.util";
import { getCollection } from "back-end/src/util/mongo.util";
import { ApiReqContext } from "back-end/types/api";
import { deriveLiveFeatureEventEnvironments } from "back-end/src/events/eventEnvironments";
import {
  createVercelExperimentationItemFromFeature,
  updateVercelExperimentationItemFromFeature,
  deleteVercelExperimentationItemFromFeature,
} from "back-end/src/services/vercel-native-integration.service";
import { getObjectDiff } from "back-end/src/events/handlers/webhooks/event-webhooks-utils";
import { runValidateFeatureHooks } from "back-end/src/enterprise/sandbox/sandbox-eval";
import {
  createEvent,
  hasPreviousObject,
  CreateEventData,
  CreateEventParams,
} from "./EventModel";
import {
  addLinkedFeatureToExperiment,
  getExperimentMapForFeature,
  removeLinkedFeatureFromExperiment,
} from "./ExperimentModel";
import {
  createInitialRevision,
  createRevisionFromLegacyDraft,
  deleteAllRevisionsForFeature,
  getRevision,
} from "./FeatureRevisionModel";
import { MakeModelClass } from "./BaseModel";

const COLLECTION_NAME = "features";

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

// ---------------------------------------------------------------------------
// Write chokepoint
// ---------------------------------------------------------------------------
// Normalize a feature-write payload to the v2 on-disk shape: strip `rules`
// from each env object, leave everything else alone. Without this scrub, stale
// `env.rules` would cause the next read to mis-classify the doc as v1 and
// re-flatten. Use for all $set payloads on feature writes.
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

// Feature ids are user-chosen keys, so `id` is required on create (the base
// CreateProps marks it optional to support generated ids).
export type CreateFeatureProps = CreateProps<FeatureInterface> & {
  id: string;
};

const BaseClass = MakeModelClass({
  schema: featureInterface,
  collectionName: COLLECTION_NAME,
  // Feature ids are user-chosen keys supplied on create (no idPrefix); the
  // base {id, organization} unique index enforces per-org uniqueness, same as
  // the legacy Mongoose index.
  additionalIndexes: [
    {
      fields: { organization: 1, project: 1 },
    },
  ],
});

export class FeatureModel extends BaseClass {
  protected canRead(doc: FeatureInterface): boolean {
    return this.context.permissions.canReadSingleProjectResource(doc.project);
  }
  protected canCreate(doc: FeatureInterface): boolean {
    return this.context.permissions.canCreateFeature(doc);
  }
  protected canUpdate(
    existing: FeatureInterface,
    updates: UpdateProps<FeatureInterface>,
  ): boolean {
    return this.context.permissions.canUpdateFeature(existing, updates);
  }
  protected canDelete(doc: FeatureInterface): boolean {
    return this.context.permissions.canDeleteFeature(doc);
  }

  protected migrate(legacyDoc: unknown): FeatureInterface {
    return migrateRawFeatureToV2(
      legacyDoc as LegacyFeatureInterface,
      this.context,
    );
  }

  protected async customValidation(
    doc: FeatureInterface,
    previousDoc?: FeatureInterface,
  ) {
    await runValidateFeatureHooks({
      context: this.context,
      feature: doc,
      original: previousDoc ?? null,
    });
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  public getAll(
    options: { projects?: string[]; includeArchived?: boolean } = {},
  ): Promise<FeatureInterface[]> {
    return this._find(this.listQuery(options));
  }

  /**
   * Lightweight sibling of {@link getAll} for the stale-detection and
   * dependents graph. Projects out heavy fields the graph does not read.
   * Same migration + permission filter as `getAll`, so results are
   * interchangeable for any caller that only needs the dependency graph.
   *
   * NOTE: the return type is `FeatureInterface[]`, but the projected-out fields
   * (`description` / `jsonSchema` / `customFields` / legacy `draft`) will be
   * absent at runtime. Only use this for graph/stale callers that don't read
   * those fields — reach for `getAll` if you need a complete feature.
   */
  public getAllForStaleGraph({
    includeArchived = false,
  }: { includeArchived?: boolean } = {}): Promise<FeatureInterface[]> {
    return this._find(this.listQuery({ includeArchived }), {
      // `draft` is the on-disk name of the legacy draft field.
      projection: {
        description: 0,
        jsonSchema: 0,
        customFields: 0,
        draft: 0,
      } as Partial<Record<keyof FeatureInterface, 0 | 1>>,
    });
  }

  private listQuery(opts: {
    projects?: string[];
    project?: string;
    includeArchived?: boolean;
  }) {
    const { projects, project, includeArchived = false } = opts;
    return {
      ...(project != null
        ? { project }
        : projects && projects.length === 1
          ? { project: projects[0] }
          : projects != null
            ? { project: { $in: projects } }
            : {}),
      ...(includeArchived ? {} : { archived: { $ne: true } }),
    };
  }

  // DB-side pagination — the default `_find` pages in memory after fetching
  // every matching doc, which is too heavy for the features list endpoint.
  public async getPage({
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
  }): Promise<FeatureInterface[]> {
    if (projectIds?.length === 0) return [];
    const q = {
      organization: this.context.org.id,
      ...this.listQuery({ project, projects: projectIds, includeArchived }),
    };
    const docs = await this._dangerousGetCollection()
      .find(q)
      .sort({ _id: 1 })
      .skip(offset)
      .limit(limit)
      .toArray();
    const features = docs.map((d) => this.migrate(omit(d, ["__v", "_id"])));
    return this.filterByReadPermissions(features);
  }

  public async count({
    project,
    projectIds,
    includeArchived = false,
  }: {
    project?: string;
    projectIds?: string[];
    includeArchived?: boolean;
  }): Promise<number> {
    if (projectIds?.length === 0) return 0;
    return this._countDocuments(
      this.listQuery({ project, projects: projectIds, includeArchived }),
    );
  }

  public async hasArchivedFeatures(project?: string): Promise<boolean> {
    const doc = await this._dangerousGetCollection().findOne(
      {
        organization: this.context.org.id,
        archived: true,
        ...(project ? { project } : {}),
      },
      { projection: { _id: 1 } },
    );
    return !!doc;
  }

  public async hasNonDemoFeature(): Promise<boolean> {
    const demoProjectId = getDemoDatasourceProjectIdForOrganization(
      this.context.org.id,
    );
    const doc = await this._dangerousGetCollection().findOne(
      {
        organization: this.context.org.id,
        project: { $ne: demoProjectId },
      },
      { projection: { _id: 1 } },
    );
    return !!doc;
  }

  // Returns id -> project for every feature that exists in the org, regardless of
  // the caller's read permission. Intended for permission decisions where missing
  // (inaccessible) and non-existent features must be distinguished — do not use it
  // to return feature data to the caller.
  public async getProjectsByIds(
    ids: string[],
  ): Promise<Map<string, string | undefined>> {
    if (!ids.length) return new Map();
    const docs = await this._dangerousGetCollection()
      .find(
        { organization: this.context.org.id, id: { $in: ids } },
        { projection: { id: 1, project: 1, _id: 0 } },
      )
      .toArray();
    return new Map(
      docs.map((f) => [f.id as string, (f.project as string) || undefined]),
    );
  }

  public async getMetaInfo(
    opts: {
      includeDefaultValue?: boolean;
      project?: string;
      ids?: string[];
    } = {},
  ): Promise<FeatureMetaInfo[]> {
    const { includeDefaultValue = false, project, ids } = opts;

    const query: Record<string, unknown> = {
      organization: this.context.org.id,
    };
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
    };
    if (includeDefaultValue) {
      projection.defaultValue = 1;
    }

    const features = (await this._dangerousGetCollection()
      .find(query, { projection })
      .toArray()) as unknown as LegacyFeatureInterface[];

    return features
      .filter((f) =>
        this.context.permissions.canReadSingleProjectResource(f.project),
      )
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
          revision: doc.revision as FeatureMetaInfo["revision"],
          ...(includeDefaultValue && { defaultValue: f.defaultValue ?? "" }),
        };
      });
  }

  public async getMetaInfoByIds(ids: string[]): Promise<FeatureMetaInfo[]> {
    if (!ids.length) return [];

    const features = (await this._dangerousGetCollection()
      .find(
        { organization: this.context.org.id, id: { $in: ids } },
        {
          projection: {
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
        },
      )
      .toArray()) as unknown as LegacyFeatureInterface[];

    return features
      .filter((f) =>
        this.context.permissions.canReadSingleProjectResource(f.project),
      )
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
        revision: (f as unknown as Record<string, unknown>)
          .revision as FeatureMetaInfo["revision"],
      }));
  }

  public async getEnvStatus(ids?: string[]): Promise<
    {
      id: string;
      environmentSettings: FeatureInterface["environmentSettings"];
    }[]
  > {
    const q: Record<string, unknown> = { organization: this.context.org.id };
    if (ids && ids.length > 0) {
      q.id = { $in: ids };
    }

    // Push project-level read restrictions into the query to avoid fetching
    // documents that will be filtered out anyway.
    const allowedProjects =
      this.context.permissions.getProjectsWithPermission("readData");
    if (allowedProjects !== null) {
      if (allowedProjects.length === 0) return [];
      // Also include features with no project — they're globally accessible
      q.$or = [
        { project: { $in: allowedProjects } },
        { project: { $in: ["", null] } },
      ];
    }

    const docs = await this._dangerousGetCollection()
      .find(q, { projection: { id: 1, environmentSettings: 1 } })
      .toArray();

    return docs.map((f) => ({
      id: f.id as string,
      // This getter only reads `enabled`, so v1 vs v2 env shape doesn't matter.
      environmentSettings: applyEnvironmentInheritance(
        this.context.org.settings?.environments || [],
        (f.environmentSettings || {}) as Record<string, FeatureEnvironment>,
      ) as FeatureInterface["environmentSettings"],
    }));
  }

  // Cross-org cron scan for the scheduled-features job. Builds a per-org job
  // context so each doc runs through the same JIT migration as normal reads.
  public static async dangerousGetScheduledFeaturesToUpdate(): Promise<
    FeatureInterface[]
  > {
    const docs = await getCollection<LegacyFeatureInterface>(COLLECTION_NAME)
      .find({
        nextScheduledUpdate: {
          $exists: true,
          $ne: null,
          $lt: new Date(),
        },
      })
      .toArray();
    const orgIds = Array.from(new Set(docs.map((f) => f.organization)));
    const jobContextsByOrg: Record<string, ApiReqContext> = {};
    await Promise.all(
      orgIds.map(async (orgId) => {
        jobContextsByOrg[orgId] = await getContextForAgendaJobByOrgId(orgId);
      }),
    );
    return docs.map((d) =>
      migrateRawFeatureToV2(
        omit(d, ["__v", "_id"]) as LegacyFeatureInterface,
        jobContextsByOrg[d.organization],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  public async create(data: CreateFeatureProps): Promise<FeatureInterface> {
    const featureToCreate = buildFeatureUpdate({
      ...data,
      linkedExperiments: getLinkedExperiments(data),
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

    const doc = await super.create(featureToCreate);
    // Same JIT pipeline as a read, so callers see canonical state
    // (e.g. environment inheritance applied).
    return this.migrate({ ...doc });
  }

  public update(
    existing: FeatureInterface,
    updates: UpdateProps<FeatureInterface>,
  ): Promise<FeatureInterface> {
    return super
      .update(existing, this.prepareUpdates(existing, updates))
      .then((doc) => this.migrate({ ...doc }));
  }

  // Same as `update` but skips the canUpdate permission check. For paths whose
  // authoritative permission is checked by the caller and isn't `manageFeatures`
  // (env toggles + revision publishes check the env-scoped `publishFeatures`)
  // and for system-driven writes running without a user.
  public dangerousUpdateBypassPermission(
    existing: FeatureInterface,
    updates: UpdateProps<FeatureInterface>,
  ): Promise<FeatureInterface> {
    return super
      .dangerousUpdateBypassPermission(
        existing,
        this.prepareUpdates(existing, updates),
      )
      .then((doc) => this.migrate({ ...doc }));
  }

  private prepareUpdates(
    existing: FeatureInterface,
    updates: UpdateProps<FeatureInterface>,
  ): UpdateProps<FeatureInterface> {
    const allUpdates = { ...updates };

    // Refresh linkedExperiments if needed
    const projected = { ...existing, ...allUpdates } as FeatureInterface;
    const linkedExperiments = getLinkedExperiments(projected);
    if (!isEqual(linkedExperiments, existing.linkedExperiments)) {
      allUpdates.linkedExperiments = linkedExperiments;
    }

    const normalizedUpdates = buildFeatureUpdate(allUpdates);

    if (Array.isArray(normalizedUpdates.rules)) {
      const { rules: dedupedRules, collisions } = ensureUniqueRuleIds(
        normalizedUpdates.rules as FeatureRule[],
      );
      if (collisions.length > 0) {
        logger.warn(
          { featureId: existing.id, collisions },
          "Duplicate rule ids auto-suffixed on feature update",
        );
        normalizedUpdates.rules = dedupedRules;
      }
    }

    return normalizedUpdates;
  }

  public async toggleMultipleEnvironments(
    feature: FeatureInterface,
    toggles: Record<string, boolean>,
  ): Promise<FeatureInterface> {
    const validEnvs = new Set(getEnvironmentIdsFromOrg(this.context.org));

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

    // If there are changes we need to apply.
    // Callers authorize toggles with the env-scoped publishFeatures permission,
    // so skip the model-level manageFeatures check.
    if (hasChanges) {
      return this.dangerousUpdateBypassPermission(feature, {
        environmentSettings: featureCopy.environmentSettings,
      });
    }

    return featureCopy;
  }

  public async toggleEnvironment(
    feature: FeatureInterface,
    environment: string,
    state: boolean,
  ): Promise<FeatureInterface> {
    return await this.toggleMultipleEnvironments(feature, {
      [environment]: state,
    });
  }

  public async setJsonSchema(
    feature: FeatureInterface,
    def: Omit<JSONSchemaDef, "date">,
  ): Promise<FeatureInterface> {
    // Validate Simple Schema (sanity check)
    if (def.schemaType === "simple" && def.simple) {
      simpleSchemaValidator.parse(def.simple);
    }

    return await this.update(feature, {
      jsonSchema: { ...def, date: new Date() },
    });
  }

  public async toggleNeverStale(
    feature: FeatureInterface,
    neverStale: boolean,
  ): Promise<FeatureInterface> {
    return await this.update(feature, { neverStale });
  }

  public async deleteAllForProject(projectId: string) {
    const featuresToDelete = await this._find(
      { project: projectId },
      { bypassReadPermissionChecks: true },
    );
    for (const feature of featuresToDelete) {
      await this.delete(feature);
    }
  }

  public async migrateDraft(feature: FeatureInterface) {
    if (!feature.legacyDraft || feature.legacyDraftMigrated) return null;

    try {
      const draft = await createRevisionFromLegacyDraft(this.context, feature);
      await this._dangerousGetCollection().updateOne(
        { organization: this.context.org.id, id: feature.id },
        { $set: { legacyDraftMigrated: true } },
      );
      return draft;
    } catch (e) {
      logger.error(e, "Error migrating old feature draft");
    }
    return null;
  }

  // Targeted write for the scheduled-features cron; bypasses the update hooks
  // so this system-driven change doesn't refresh SDK payloads or fire events.
  public async updateNextScheduledDate(
    feature: FeatureInterface,
    nextScheduledUpdate: Date | null,
  ): Promise<FeatureInterface> {
    const dateUpdated = new Date();
    await this._dangerousGetCollection().updateOne(
      { organization: this.context.org.id, id: feature.id },
      { $set: { nextScheduledUpdate, dateUpdated } },
    );
    return {
      ...feature,
      nextScheduledUpdate: nextScheduledUpdate ?? undefined,
      dateUpdated,
    };
  }

  public async addLinkedExperiment(
    feature: FeatureInterface,
    experimentId: string,
  ) {
    if (feature.linkedExperiments?.includes(experimentId)) return;

    await this._dangerousGetCollection().updateOne(
      { organization: this.context.org.id, id: feature.id },
      { $addToSet: { linkedExperiments: experimentId } },
    );
  }

  // Bare $unset without hooks — used by the publish path, which fires its own
  // update side-effects via the subsequent `update` call.
  public async removeHoldout(feature: FeatureInterface) {
    if (!feature.holdout) return;
    await this._dangerousGetCollection().updateOne(
      { organization: this.context.org.id, id: feature.id },
      { $unset: { holdout: "" } },
    );
  }

  public async removeTagFromAllFeatures(tag: string) {
    const query = { organization: this.context.org.id, tags: tag };

    const docs = await this._dangerousGetCollection().find(query).toArray();
    const features = docs.map((d) => this.migrate(omit(d, ["__v", "_id"])));

    const pullTag: UpdateFilter<FeatureInterface> = { tags: tag };
    await this._dangerousGetCollection().updateMany(query, {
      $pull: pullTag,
    });

    features.forEach((feature) => {
      const updatedFeature = {
        ...feature,
        tags: (feature.tags || []).filter((t) => t !== tag),
      };

      this.onFeatureUpdate(feature, updatedFeature).catch((e) => {
        logger.error(e, "Error refreshing SDK Payload on feature update");
      });
    });
  }

  public async removeProjectFromAllFeatures(project: string) {
    const query = { organization: this.context.org.id, project };

    const docs = await this._dangerousGetCollection().find(query).toArray();
    const features = docs.map((d) => this.migrate(omit(d, ["__v", "_id"])));

    await this._dangerousGetCollection().updateMany(query, {
      $set: { project: "" },
    });

    features.forEach((feature) => {
      const updatedFeature = {
        ...feature,
        project: "",
      };

      this.onFeatureUpdate(feature, updatedFeature, project).catch((e) => {
        logger.error(e, "Error refreshing SDK Payload on feature update");
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Lifecycle hooks
  // ---------------------------------------------------------------------------

  protected async afterCreate(doc: FeatureInterface) {
    const feature = this.migrate({ ...doc });

    // Historically, we haven't properly removed revisions when deleting a feature
    // So, clean up any conflicting revisions first before creating a new one
    await deleteAllRevisionsForFeature(this.context.org.id, feature.id);

    await createInitialRevision(
      this.context,
      feature,
      this.context.auditUser,
      getEnvironmentIdsFromOrg(this.context.org),
    );

    if (feature.linkedExperiments?.length) {
      await Promise.all(
        feature.linkedExperiments.map(async (exp) => {
          await addLinkedFeatureToExperiment(this.context, exp, feature.id);
        }),
      );
    }

    this.onFeatureCreate(feature).catch((e) => {
      logger.error(e, "Error refreshing SDK Payload on feature create");
    });
  }

  protected async afterUpdate(
    existing: FeatureInterface,
    updates: UpdateProps<FeatureInterface>,
    newDoc: FeatureInterface,
  ) {
    // New experiments this feature was added to
    const experimentsAdded = (newDoc.linkedExperiments ?? []).filter(
      (exp) => !existing.linkedExperiments?.includes(exp),
    );
    if (experimentsAdded.length > 0) {
      await Promise.all(
        experimentsAdded.map(async (exp) => {
          await addLinkedFeatureToExperiment(this.context, exp, newDoc.id);
        }),
      );
    }

    const updatedFeature = this.migrate({ ...newDoc });
    this.onFeatureUpdate(existing, updatedFeature).catch((e) => {
      logger.error(e, "Error refreshing SDK Payload on feature update");
    });
  }

  protected async afterDelete(doc: FeatureInterface) {
    await deleteAllRevisionsForFeature(this.context.org.id, doc.id);
    await this.context.models.featureRevisionLogs.deleteAllByFeature(doc);

    if (doc.linkedExperiments) {
      await Promise.all(
        doc.linkedExperiments.map(async (exp) => {
          await removeLinkedFeatureFromExperiment(this.context, exp, doc.id);
        }),
      );
    }

    this.onFeatureDelete(doc).catch((e) => {
      logger.error(e, "Error refreshing SDK Payload on feature delete");
    });
  }

  // ---------------------------------------------------------------------------
  // Side effects (SDK payload refresh, event webhooks, Vercel sync)
  // ---------------------------------------------------------------------------

  private async onFeatureCreate(feature: FeatureInterface) {
    queueSDKPayloadRefresh({
      context: this.context,
      payloadKeys: getAffectedSDKPayloadKeys(
        [feature],
        getEnvironmentIdsFromOrg(this.context.org),
      ),
      auditContext: {
        event: "created",
        model: "feature",
        id: feature.id,
      },
    });

    await logFeatureCreatedEvent(this.context, feature);

    if (this.context.org.isVercelIntegration)
      await createVercelExperimentationItemFromFeature({
        feature,
        organization: this.context.org,
      });
  }

  private async onFeatureDelete(feature: FeatureInterface) {
    queueSDKPayloadRefresh({
      context: this.context,
      payloadKeys: getAffectedSDKPayloadKeys(
        [feature],
        getEnvironmentIdsFromOrg(this.context.org),
      ),
      auditContext: {
        event: "deleted",
        model: "feature",
        id: feature.id,
      },
    });

    await logFeatureDeletedEvent(this.context, feature);

    if (this.context.org.isVercelIntegration)
      await deleteVercelExperimentationItemFromFeature({
        feature,
        organization: this.context.org,
      });
  }

  private async onFeatureUpdate(
    feature: FeatureInterface,
    updatedFeature: FeatureInterface,
    skipRefreshForProject?: string,
  ) {
    queueSDKPayloadRefresh({
      context: this.context,
      payloadKeys: getSDKPayloadKeysByDiff(
        feature,
        updatedFeature,
        getEnvironmentIdsFromOrg(this.context.org),
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
      await logFeatureUpdatedEvent(this.context, feature, updatedFeature);
    }

    if (this.context.org.isVercelIntegration)
      await updateVercelExperimentationItemFromFeature({
        feature: updatedFeature,
        organization: this.context.org,
      });
  }
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
