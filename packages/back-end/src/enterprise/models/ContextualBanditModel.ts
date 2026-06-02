import {
  ContextualBanditInterface,
  contextualBanditValidator,
  ExperimentInterface,
  LeafWeight,
} from "shared/validators";
import { MakeModelClass } from "back-end/src/models/BaseModel";

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

export class ContextualBanditModel extends BaseClass {
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
  // We hook the read path rather than `migrate` because the backfill needs
  // the parent experiment, which is async and only available after
  // `populateForeignRefs`. Once PR-8 lands the backfill is a no-op and the
  // overrides are deleted.
  // ---------------------------------------------------------------------

  private hydrate(doc: ContextualBanditInterface): ContextualBanditInterface {
    if (hasNativeShape(doc)) return doc;
    const { experiment } = this.getForeignRefs(doc, false);
    if (!experiment) return doc;
    return backfillFromExperiment(doc, experiment);
  }

  public async getById(id: string): Promise<ContextualBanditInterface | null> {
    const doc = await super.getById(id);
    return doc ? this.hydrate(doc) : null;
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
