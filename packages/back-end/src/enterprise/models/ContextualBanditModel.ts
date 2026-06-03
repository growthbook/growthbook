import {
  ApiContextualBanditInterface,
  ContextualBanditInterface,
  contextualBanditValidator,
  ExperimentInterface,
  LeafWeight,
} from "shared/validators";
import { resolveOwnerEmails } from "back-end/src/services/owner";
import {
  contextualBanditApiSpec,
  refreshContextualBanditEndpoint,
  startContextualBanditEndpoint,
  stopContextualBanditEndpoint,
} from "back-end/src/api/specs/contextual-bandit.spec";
import { defineCustomApiHandler } from "back-end/src/api/apiModelHandlers";
import {
  executeContextualBanditStart,
  executeContextualBanditStop,
} from "back-end/src/services/contextualBanditChanges";
import { runContextualBanditSnapshot } from "back-end/src/enterprise/services/contextualBandits";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { MakeModelClass } from "back-end/src/models/BaseModel";
import { getCollection } from "back-end/src/util/mongo.util";

const COLLECTION = "contextualbandits";

const BaseClass = MakeModelClass({
  schema: contextualBanditValidator,
  collectionName: "contextualbandits",
  idPrefix: "cb_",
  globallyUniquePrimaryKeys: true,
  additionalIndexes: [
    {
      fields: { organization: 1, experiment: 1 },
      unique: true,
    },
  ],
  // TODO(holdout-v1.5): these two fields are intentionally inert in v1; the
  // defaults let callers omit them so future docs round-trip cleanly without
  // a schema break when the holdout pipeline ships.
  defaultValues: {
    holdoutPercent: 0,
    disableStickyBucketing: false,
  },
  // Auto-emits contextualBandit.create / update / delete on the BaseModel
  // CRUD paths. Lifecycle events (`start` / `stop`) are emitted directly
  // from `services/contextualBanditChanges.ts`. v1.5 will wire the
  // events/handlers/{slack,webhooks,email} subscribers — for now these
  // events are recorded but not propagated to any subscriber surface.
  auditLog: {
    entity: "contextualBandit",
    createEvent: "contextualBandit.create",
    updateEvent: "contextualBandit.update",
    deleteEvent: "contextualBandit.delete",
  },
  apiConfig: {
    modelKey: "contextualBandits",
    openApiSpec: contextualBanditApiSpec,
    customHandlers: [
      defineCustomApiHandler({
        ...startContextualBanditEndpoint,
        reqHandler: async (req) => {
          const cb = await req.context.models.contextualBandits.getById(
            req.params.id,
          );
          if (!cb) {
            return req.context.throwNotFoundError();
          }
          const envs =
            req.context.org.settings?.environments?.map((e) => e.id) ?? [];
          if (!req.context.permissions.canRunContextualBandit(cb, envs)) {
            req.context.permissions.throwPermissionError();
          }
          const { updated } = await executeContextualBanditStart(
            req.context,
            cb,
          );
          return { contextualBandit: toApiContextualBandit(updated) };
        },
      }),
      defineCustomApiHandler({
        ...stopContextualBanditEndpoint,
        reqHandler: async (req) => {
          const cb = await req.context.models.contextualBandits.getById(
            req.params.id,
          );
          if (!cb) {
            return req.context.throwNotFoundError();
          }
          const envs =
            req.context.org.settings?.environments?.map((e) => e.id) ?? [];
          if (!req.context.permissions.canRunContextualBandit(cb, envs)) {
            req.context.permissions.throwPermissionError();
          }
          const { updated } = await executeContextualBanditStop(
            req.context,
            cb,
            { allowAlreadyStopped: true },
          );
          return { contextualBandit: toApiContextualBandit(updated) };
        },
      }),
      defineCustomApiHandler({
        ...refreshContextualBanditEndpoint,
        reqHandler: async (req) => {
          // Type cast: at the depth of the third inline customHandler in
          // this file, tsc gives up resolving the model instance lookup
          // (`Property 'contextualBandits' does not exist on
          // type 'ModelInstances'`) — likely because the surrounding
          // generic-rich `defineCustomApiHandler` calls + the
          // runContextualBanditSnapshot return-type pull the inference
          // budget past its limit. The cast is safe (ContextualBanditModel
          // IS registered in `services/context.ts`) and only here so the
          // handler compiles; remove once tsc inference tightens up.
          const cbModel = (
            req.context.models as unknown as {
              contextualBandits: {
                getById: (
                  id: string,
                ) => Promise<ContextualBanditInterface | null>;
              };
            }
          ).contextualBandits;
          const cb = await cbModel.getById(req.params.id);
          if (!cb) {
            return req.context.throwNotFoundError();
          }
          const envs =
            req.context.org.settings?.environments?.map((e) => e.id) ?? [];
          if (!req.context.permissions.canRunContextualBandit(cb, envs)) {
            req.context.permissions.throwPermissionError();
          }
          if (!cb.phases.length) {
            throw new Error("Contextual Bandit has no phases");
          }
          if (!cb.experiment) {
            throw new Error(
              "Contextual Bandit has no parent experiment FK; cannot refresh until PR-8 migration",
            );
          }
          const experiment = await getExperimentById(
            req.context,
            cb.experiment,
          );
          if (!experiment) {
            return req.context.throwNotFoundError();
          }
          const phase = cb.phases.length - 1;
          return runContextualBanditSnapshot(req.context, experiment, phase, {
            triggeredBy: "manual",
          });
        },
      }),
    ],
  },
});

/**
 * Heuristic check for whether a CB doc was written against the post-PR-2
 * validator shape. The legacy shape only carried the FK + a handful of
 * tree-config fields; the new shape adds CB-native ownership/lifecycle data,
 * notably `name`. A non-empty `name` is the simplest, most stable signal.
 *
 * Once the data migration in PR-8 has run, every CB doc has CB-native data
 * and this guard becomes vacuously true — at which point both the helper
 * and the experiment-fallback branches in permission checks below can be
 * deleted.
 */
function hasNativeShape(doc: ContextualBanditInterface): boolean {
  return !!doc.name;
}

/**
 * Backfill CB-native ownership/lifecycle fields from the parent experiment
 * on read. Called after `_find`/`_findOne` have populated foreign refs but
 * before downstream consumers (snapshot orchestrator, REST API, results
 * UI, …) read the doc. Idempotent: a no-op for docs that already carry
 * native data.
 *
 * Returns a new object; does not mutate the input. The caller assigns the
 * result back into the doc list so subsequent reads (including the
 * permission check) see the backfilled values.
 *
 * Deleted in PR-8 along with the FK column and the legacy migrate branch.
 */
function backfillFromExperiment(
  doc: ContextualBanditInterface,
  experiment: ExperimentInterface,
): ContextualBanditInterface {
  if (hasNativeShape(doc)) return doc;

  return {
    ...doc,
    name: doc.name || experiment.name,
    description: doc.description ?? experiment.description,
    hypothesis: doc.hypothesis ?? experiment.hypothesis,
    project: doc.project ?? experiment.project,
    owner: doc.owner || experiment.owner,
    tags: doc.tags?.length ? doc.tags : (experiment.tags ?? []),
    archived: doc.archived ?? experiment.archived ?? false,
    customFields: doc.customFields ?? experiment.customFields,
    status:
      doc.status ??
      (experiment.status === "running" || experiment.status === "stopped"
        ? experiment.status
        : "draft"),
    trackingKey: doc.trackingKey || experiment.trackingKey,
    hashAttribute: doc.hashAttribute || experiment.hashAttribute,
    fallbackAttribute: doc.fallbackAttribute ?? experiment.fallbackAttribute,
    hashVersion: doc.hashVersion ?? experiment.hashVersion,
    disableStickyBucketing:
      doc.disableStickyBucketing ?? experiment.disableStickyBucketing ?? false,
    variations: doc.variations?.length
      ? doc.variations
      : (experiment.variations ?? []),
    datasource:
      doc.datasource || doc.datasourceId || experiment.datasource || "",
    segment: doc.segment ?? experiment.segment,
    queryFilter: doc.queryFilter ?? experiment.queryFilter,
    goalMetrics: doc.goalMetrics?.length
      ? doc.goalMetrics
      : (experiment.goalMetrics ?? []),
    secondaryMetrics: doc.secondaryMetrics?.length
      ? doc.secondaryMetrics
      : (experiment.secondaryMetrics ?? []),
    guardrailMetrics: doc.guardrailMetrics?.length
      ? doc.guardrailMetrics
      : (experiment.guardrailMetrics ?? []),
    activationMetric: doc.activationMetric ?? experiment.activationMetric,
    metricOverrides: doc.metricOverrides ?? experiment.metricOverrides,
    attributionModel: doc.attributionModel ?? experiment.attributionModel,
    skipPartialData: doc.skipPartialData ?? experiment.skipPartialData,
    regressionAdjustmentEnabled:
      doc.regressionAdjustmentEnabled ?? experiment.regressionAdjustmentEnabled,
  };
}

/**
 * Convert an internal CB doc to the REST API response shape. The API
 * surface is intentionally a curated subset of `ContextualBanditInterface`
 * so internal-only state (linkedFeatures, pendingFeatureDrafts, snapshot
 * scheduling, the legacy `experiment` FK) is not exposed.
 *
 * Defined as a free function (rather than a model method) so the custom
 * lifecycle handlers in the apiConfig can serialize without inducing a
 * circular type-inference cycle through `req.context.models.contextualBandits`.
 */
export function toApiContextualBandit(
  doc: ContextualBanditInterface,
): ApiContextualBanditInterface {
  return {
    id: doc.id,
    dateCreated: doc.dateCreated.toISOString(),
    dateUpdated: doc.dateUpdated.toISOString(),
    name: doc.name,
    description: doc.description,
    hypothesis: doc.hypothesis,
    project: doc.project,
    owner: doc.owner,
    tags: doc.tags,
    archived: doc.archived,
    customFields: doc.customFields,
    status: doc.status,
    dateStarted: doc.dateStarted?.toISOString(),
    dateStopped: doc.dateStopped?.toISOString(),
    trackingKey: doc.trackingKey,
    hashAttribute: doc.hashAttribute,
    fallbackAttribute: doc.fallbackAttribute,
    hashVersion: doc.hashVersion,
    disableStickyBucketing: doc.disableStickyBucketing,
    variations: doc.variations.map((v) => ({
      id: v.id,
      key: v.key,
      name: v.name,
      description: v.description,
    })),
    datasource: doc.datasource,
    exposureQueryId: doc.exposureQueryId,
    segment: doc.segment,
    queryFilter: doc.queryFilter,
    goalMetrics: doc.goalMetrics,
    secondaryMetrics: doc.secondaryMetrics,
    guardrailMetrics: doc.guardrailMetrics,
    activationMetric: doc.activationMetric,
    attributionModel: doc.attributionModel,
    skipPartialData: doc.skipPartialData,
    regressionAdjustmentEnabled: doc.regressionAdjustmentEnabled,
    phases: doc.phases.map((p) => ({
      dateStarted: p.dateStarted.toISOString(),
      dateEnded: p.dateEnded ? p.dateEnded.toISOString() : p.dateEnded,
      coverage: p.coverage,
      condition: p.condition,
      seed: p.seed,
      variationWeights: p.variationWeights,
      currentLeafWeights: p.currentLeafWeights,
    })),
    contextualAttributes: doc.contextualAttributes,
    decisionMetric: doc.decisionMetric,
    maxContexts: doc.maxContexts,
    treeModel: doc.treeModel,
    minUsersPerLeaf: doc.minUsersPerLeaf,
    maxLeaves: doc.maxLeaves,
    holdoutPercent: doc.holdoutPercent,
    canonicalFormVersion: doc.canonicalFormVersion,
  };
}

export class ContextualBanditModel extends BaseClass {
  /**
   * BaseModel hook: returns the API-shaped response for default CRUD paths.
   * Delegates to the free function so custom handlers can serialize without
   * needing a model-instance reference.
   */
  protected toApiInterface(
    doc: ContextualBanditInterface,
  ): ApiContextualBanditInterface {
    return toApiContextualBandit(doc);
  }

  /**
   * Gate the REST surface on the commercial feature flag. The internal
   * GrowthBook app is allowed to read CBs even on plans without the
   * feature (the front-end UI hides the workflow itself), but external
   * customers shouldn't be able to author them.
   */
  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("contextual-bandits");
  }

  /**
   * List with optional `projectId` / `datasourceId` filters. Matches the
   * pattern used by ExperimentTemplatesModel — derives the query from the
   * spec's `apiListContextualBanditsValidator` schema.
   */
  public override async handleApiList(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiList"]>[0],
  ): Promise<ApiContextualBanditInterface[]> {
    const { projectId, datasourceId } = req.query;
    const filter: Record<string, string> = {};
    if (projectId) filter.project = projectId;
    if (datasourceId) filter.datasource = datasourceId;
    const docs = Object.keys(filter).length
      ? await this._find(filter)
      : await this.getAll();
    return resolveOwnerEmails(
      docs.map((doc) => this.toApiInterface(doc)),
      this.context,
    );
  }

  /**
   * Migration: backfill required CB-native fields with safe defaults so a
   * legacy CB doc (FK-only, no ownership/lifecycle data) validates against
   * the new schema. The *real* values for these fields come from the parent
   * experiment via `backfillFromExperiment`, which runs after foreign refs
   * are populated — see `_find` / `_findOne` overrides below.
   *
   * Dropped in PR-8 once the data migration runs.
   */
  protected migrate(legacyDoc: unknown): ContextualBanditInterface {
    const doc = legacyDoc as Partial<ContextualBanditInterface> &
      Record<string, unknown>;

    return {
      ...doc,
      name: doc.name ?? "",
      owner: doc.owner ?? "",
      tags: doc.tags ?? [],
      archived: doc.archived ?? false,
      status: doc.status ?? "draft",
      trackingKey: doc.trackingKey ?? "",
      hashAttribute: doc.hashAttribute ?? "",
      hashVersion: doc.hashVersion ?? 2,
      disableStickyBucketing: doc.disableStickyBucketing ?? false,
      variations: doc.variations ?? [],
      datasource: doc.datasource ?? doc.datasourceId ?? "",
      goalMetrics: doc.goalMetrics ?? [],
      secondaryMetrics: doc.secondaryMetrics ?? [],
      guardrailMetrics: doc.guardrailMetrics ?? [],
      defaultMetricPriorSettings: doc.defaultMetricPriorSettings ?? {
        override: false,
        proper: false,
        mean: 0,
        stddev: 0.1,
      },
      contextualAttributes: doc.contextualAttributes ?? [],
    } as ContextualBanditInterface;
  }

  // ---------------------------------------------------------------------
  // Permission checks
  //
  // Source of truth is the CB doc itself when it carries CB-native fields
  // (`hasNativeShape`). Legacy docs (pre-decoupling) fall back to the
  // parent experiment via the FK, matching the previous behaviour. Once
  // the data migration in PR-8 runs, the fallback branch is unreachable
  // and gets removed.
  //
  // Missing parent in the fallback path is treated as no-access —
  // never default-allow.
  // ---------------------------------------------------------------------

  protected canRead(doc: ContextualBanditInterface): boolean {
    if (hasNativeShape(doc)) {
      return this.context.permissions.canReadSingleProjectResource(doc.project);
    }
    const { experiment } = this.getForeignRefs(doc, false);
    if (!experiment) return false;
    return this.context.permissions.canReadSingleProjectResource(
      experiment.project,
    );
  }

  /**
   * Resolve the affected environments for a CB. CBs don't carry phase-level
   * environment metadata yet (the SDK rule emitter scopes by feature
   * environment instead) so we conservatively check every org environment —
   * equivalent to `getAffectedEnvsForExperiment` for a no-phase experiment.
   * The runExperiments env permission is reused per the decoupling plan §2.
   */
  private affectedEnvs(): string[] {
    return (this.context.org.settings?.environments || []).map((e) => e.id);
  }

  private canWrite(doc: ContextualBanditInterface): boolean {
    if (hasNativeShape(doc)) {
      return this.context.permissions.canRunContextualBandit(
        doc,
        this.affectedEnvs(),
      );
    }
    const { experiment } = this.getForeignRefs(doc, false);
    if (!experiment) return false;
    return this.context.permissions.canRunContextualBandit(
      { project: experiment.project },
      this.affectedEnvs(),
    );
  }

  protected canCreate(doc: ContextualBanditInterface): boolean {
    if (hasNativeShape(doc)) {
      return this.context.permissions.canCreateContextualBandit(doc);
    }
    // No native shape on a new create is unusual but treated as the legacy
    // path: fall through to the env-scoped write check.
    return this.canWrite(doc);
  }

  protected canUpdate(
    existing: ContextualBanditInterface,
    updated?: Partial<ContextualBanditInterface>,
  ): boolean {
    if (hasNativeShape(existing)) {
      return this.context.permissions.canUpdateContextualBandit(
        existing,
        updated ?? existing,
      );
    }
    return this.canWrite(existing);
  }

  protected canDelete(doc: ContextualBanditInterface): boolean {
    if (hasNativeShape(doc)) {
      return this.context.permissions.canDeleteContextualBandit(doc);
    }
    const { experiment } = this.getForeignRefs(doc, false);
    if (!experiment) return false;
    return this.context.permissions.canDeleteExperiment(experiment);
  }

  // ---------------------------------------------------------------------
  // Read overrides — apply the experiment-backed backfill after foreign
  // refs are loaded so downstream consumers see a fully populated doc.
  //
  // Hydration runs on the public read accessors rather than in `migrate`
  // because the backfill needs the parent experiment, which is async and
  // only available after `populateForeignRefs`. Every external read path
  // funnels through one of the accessors below (single-doc reads via
  // getById/getByExperimentId, list reads via getAll/getByIds), so they
  // are each wrapped — this is what guarantees list pages, the REST list
  // endpoint, and the agenda jobs see backfilled values, not just
  // single-doc fetches. The only internal `_find` caller is
  // getByExperimentId, which hydrates its result explicitly.
  //
  // The backfill is a no-op for native docs, so once the PR-8 data
  // migration runs this whole block can be deleted.
  // ---------------------------------------------------------------------

  private hydrate(doc: ContextualBanditInterface): ContextualBanditInterface {
    if (hasNativeShape(doc)) return doc;
    const { experiment } = this.getForeignRefs(doc, false);
    if (!experiment) return doc;
    return backfillFromExperiment(doc, experiment);
  }

  private hydrateMany(
    docs: ContextualBanditInterface[],
  ): ContextualBanditInterface[] {
    // Fast path: nothing to backfill once every doc carries native shape.
    if (docs.every(hasNativeShape)) return docs;
    return docs.map((doc) => this.hydrate(doc));
  }

  public async getById(id: string): Promise<ContextualBanditInterface | null> {
    const doc = await super.getById(id);
    return doc ? this.hydrate(doc) : null;
  }

  public async getByIds(ids: string[]): Promise<ContextualBanditInterface[]> {
    return this.hydrateMany(await super.getByIds(ids));
  }

  public async getAll(): Promise<ContextualBanditInterface[]> {
    return this.hydrateMany(await super.getAll());
  }

  public async getByExperimentId(
    experiment: string,
  ): Promise<ContextualBanditInterface | null> {
    const results = await this._find({ experiment });
    const doc = results[0] ?? null;
    return doc ? this.hydrate(doc) : null;
  }

  /**
   * Atomically update the leaf weights for a specific phase index.
   * Replaces `phases[phaseIndex].currentLeafWeights` in place via a single
   * Mongo `$set` with positional dot-notation — concurrent refreshes (cron
   * + manual API + scheduled retraining) can collide on the same CB doc,
   * and a read-modify-write would lose updates between the read and the
   * write. The atomic positional update guarantees only the target field
   * changes regardless of overlapping writers.
   */
  public async patchPhaseWeights(
    cbId: string,
    phaseIndex: number,
    leafWeights: LeafWeight[],
  ): Promise<ContextualBanditInterface> {
    const existing = await this.getById(cbId);
    if (!existing) {
      throw new Error(`ContextualBandit not found: ${cbId}`);
    }
    if (phaseIndex < 0 || phaseIndex >= existing.phases.length) {
      throw new Error(
        `Phase index ${phaseIndex} out of range (0..${existing.phases.length - 1})`,
      );
    }
    // BaseModel.updateById would re-check canUpdate; we bypass it for the
    // atomic single-field update below, so re-assert the same gate here.
    if (!this.canUpdate(existing)) {
      this.context.permissions.throwPermissionError();
    }

    const collection = this._dangerousGetCollection();
    const now = new Date();
    const res = await collection.updateOne(
      {
        organization: this.context.org.id,
        id: cbId,
        // Guard against the phase being removed between the bounds check
        // above and this write. If the phase array shrank, the update no-ops
        // and we surface a clear error below.
        [`phases.${phaseIndex}`]: { $exists: true },
      },
      {
        $set: {
          [`phases.${phaseIndex}.currentLeafWeights`]: leafWeights,
          dateUpdated: now,
        },
      },
    );
    if (res.matchedCount === 0) {
      throw new Error(
        `ContextualBandit ${cbId} phases[${phaseIndex}] could not be updated`,
      );
    }

    const refreshed = await this.getById(cbId);
    if (!refreshed) {
      throw new Error(`ContextualBandit ${cbId} disappeared after update`);
    }
    return refreshed;
  }

  // ---------------------------------------------------------------------
  // Linked-features / pendingFeatureDrafts maintenance
  //
  // Atomic Mongo updates so the feature-revision sync path
  // (`featureContextualBanditSync.ts`) can reconcile linkages without
  // having to read-modify-write the whole CB doc. Permission checks are
  // intentionally bypassed here — the sync runs fire-and-forget after a
  // revision write has already been authorized.
  // ---------------------------------------------------------------------

  public async addLinkedFeature(
    cbId: string,
    featureId: string,
  ): Promise<void> {
    await this._dangerousGetCollection().updateOne(
      { organization: this.context.org.id, id: cbId },
      { $addToSet: { linkedFeatures: featureId } },
    );
  }

  public async removeLinkedFeature(
    cbId: string,
    featureId: string,
  ): Promise<void> {
    await this._dangerousGetCollection().updateOne(
      { organization: this.context.org.id, id: cbId },
      { $pull: { linkedFeatures: featureId } },
    );
  }

  // $addToSet is atomic and idempotent on (featureId, revisionVersion).
  // Multiple drafts of the same feature are intentionally allowed and
  // applied sequentially at CB start.
  public async addPendingFeatureDraft(
    cbId: string,
    featureId: string,
    revisionVersion: number,
  ): Promise<void> {
    await this._dangerousGetCollection().updateOne(
      { organization: this.context.org.id, id: cbId },
      {
        $addToSet: {
          pendingFeatureDrafts: { featureId, revisionVersion },
        },
      },
    );
  }

  public async removePendingFeatureDraft(
    cbId: string,
    featureId: string,
    revisionVersion?: number,
  ): Promise<void> {
    const pullFilter =
      revisionVersion != null ? { featureId, revisionVersion } : { featureId };
    await this._dangerousGetCollection().updateOne(
      { organization: this.context.org.id, id: cbId },
      { $pull: { pendingFeatureDrafts: pullFilter } },
    );
  }

  // Strip pending drafts for `featureId` on every CB *not* in `keepIds`.
  // Mirrors `ExperimentModel.updateMany` cleanup in the experiment sync.
  public async clearStalePendingFeatureDrafts(
    featureId: string,
    keepIds: string[],
  ): Promise<void> {
    await this._dangerousGetCollection().updateMany(
      {
        organization: this.context.org.id,
        "pendingFeatureDrafts.featureId": featureId,
        id: { $nin: keepIds },
      },
      // Cast required because the Mongo driver's $pull typing is invariant
      // over the array element shape, and the BaseModel collection is typed
      // with the full Zod-inferred ContextualBanditInterface; the filter
      // `{ featureId }` is a valid element-shaped predicate at runtime.
      {
        $pull: {
          pendingFeatureDrafts: { featureId },
        },
      } as unknown as Parameters<
        ReturnType<
          ContextualBanditModel["_dangerousGetCollection"]
        >["updateMany"]
      >[1],
    );
  }

  public async deleteForExperiment(experiment: string): Promise<void> {
    await this._dangerousGetCollection().deleteMany({
      organization: this.context.org.id,
      experiment,
    });
  }
}

/**
 * Cross-org CB query for the auto-snapshot agenda job. Lives as a free
 * function (not a model method) because the job runs without a user
 * context — there's no `req.context.models.contextualBandits` to call.
 *
 * Mirrors `getExperimentsToUpdate` for experiments: returns running CBs
 * whose `nextSnapshotAttempt` is due, scoped per org. The agenda job
 * resolves a per-org `ReqContext` for each result.
 *
 * The `dangerous` prefix matches the static-method convention from
 * `legacy-model-migration-patterns.md`: this bypasses BaseModel's
 * in-org query protections (it has to, the job has no org context).
 */
export async function dangerousFindContextualBanditsToUpdate(
  excludeIds: string[],
): Promise<Pick<ContextualBanditInterface, "id" | "organization">[]> {
  const docs = await getCollection<ContextualBanditInterface>(COLLECTION)
    .find({
      datasource: { $exists: true, $ne: "" },
      status: "running",
      autoSnapshots: true,
      nextSnapshotAttempt: {
        $exists: true,
        $lte: new Date(),
      },
      id: { $nin: excludeIds },
    })
    .project<Pick<ContextualBanditInterface, "id" | "organization">>({
      id: true,
      organization: true,
    })
    .limit(100)
    .sort({ nextSnapshotAttempt: 1 })
    .toArray();

  return docs.map((d) => ({ id: d.id, organization: d.organization }));
}
