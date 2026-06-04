import {
  apiCreateContextualBanditBody,
  apiUpdateContextualBanditBody,
  ApiContextualBanditInterface,
  CONTEXTUAL_BANDIT_API_UPDATE_FIELDS,
  ContextualBanditInterface,
  contextualBanditValidator,
  LeafWeight,
} from "shared/validators";
import { generateVariationId } from "shared/util";
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
import { MakeModelClass } from "back-end/src/models/BaseModel";
import { getCollection } from "back-end/src/util/mongo.util";

const COLLECTION = "contextualbandits";

const BaseClass = MakeModelClass({
  schema: contextualBanditValidator,
  collectionName: "contextualbandits",
  idPrefix: "cb_",
  globallyUniquePrimaryKeys: true,
  // Defaults so the REST create can omit fields the schema requires (tree config, holdout, phases, …).
  defaultValues: {
    holdoutPercent: 0,
    disableStickyBucketing: false,
    archived: false,
    maxContexts: 300,
    treeModel: "regression_tree",
    minUsersPerLeaf: 100,
    maxLeaves: 12,
    canonicalFormVersion: 1,
  },
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
          // Cast required: tsc fails to resolve `models.contextualBandits` at this nesting depth.
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
          const phase = cb.phases.length - 1;
          return runContextualBanditSnapshot(req.context, cb, phase, {
            triggeredBy: "manual",
          });
        },
      }),
    ],
  },
});

/** Curated CB → REST response shape; internal-only fields are omitted. Free function to avoid circular type inference. */
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
  protected toApiInterface(
    doc: ContextualBanditInterface,
  ): ApiContextualBanditInterface {
    return toApiContextualBandit(doc);
  }

  /** Gate the REST surface on the commercial feature flag (internal app reads bypass via UI). */
  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("contextual-bandits");
  }

  /** List with optional projectId/datasourceId/trackingKey filters; trackingKey supports create-form collision preflight. */
  public override async handleApiList(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiList"]>[0],
  ): Promise<ApiContextualBanditInterface[]> {
    const { projectId, datasourceId, trackingKey } = req.query;
    const filter: Record<string, string> = {};
    if (projectId) filter.project = projectId;
    if (datasourceId) filter.datasource = datasourceId;
    if (trackingKey) filter.trackingKey = trackingKey;
    const docs = Object.keys(filter).length
      ? await this._find(filter)
      : await this.getAll();
    return resolveOwnerEmails(
      docs.map((doc) => this.toApiInterface(doc)),
      this.context,
    );
  }

  /** Injects runtime-derived defaults (fresh Date, per-org settings) the static `defaultValues` can't carry. */
  protected async processApiCreateBody(rawBody: unknown) {
    const body = apiCreateContextualBanditBody.parse(rawBody);
    const orgPrior = this.context.org.settings?.metricDefaults?.priorSettings;

    return {
      ...body,
      tags: body.tags ?? [],
      // `_createOne` resolves owner; empty fallback satisfies the TS shape pre-hook.
      owner: body.owner ?? "",
      // Restated so the return type satisfies `CreateProps` (tsc can't see runtime default-merge).
      archived: false,
      holdoutPercent: 0,
      canonicalFormVersion: 1,
      maxContexts: body.maxContexts ?? 300,
      treeModel: body.treeModel ?? "regression_tree",
      minUsersPerLeaf: body.minUsersPerLeaf ?? 100,
      maxLeaves: body.maxLeaves ?? 12,
      hashAttribute: body.hashAttribute ?? "id",
      hashVersion: body.hashVersion ?? (2 as const),
      disableStickyBucketing: body.disableStickyBucketing ?? false,
      // Backfill per-variation id/screenshots so the internal validator accepts the doc.
      variations: body.variations.map((v) => ({
        ...v,
        id: generateVariationId(),
        screenshots: [],
      })),
      // Alias kept in lockstep with `datasource` for legacy shape parity.
      datasourceId: body.datasource,
      // SQL-side spelling mirrored so the snapshot orchestrator reads either.
      targetingAttributeColumns: body.contextualAttributes,
      contextualAttributes: body.contextualAttributes,
      status: "draft" as const,
      secondaryMetrics: body.secondaryMetrics ?? [],
      guardrailMetrics: body.guardrailMetrics ?? [],
      // Seed an open phase so the CB has somewhere to record `currentLeafWeights` once it starts.
      phases: [{ dateStarted: new Date(), currentLeafWeights: [] }],
      defaultMetricPriorSettings: orgPrior ?? {
        override: false,
        proper: false,
        mean: 0,
        stddev: 0.1,
      },
    };
  }

  /** Filters the update body to the CB-shape subset and mirrors datasource/contextualAttributes aliases. */
  protected async processApiUpdateBody(rawBody: unknown) {
    const body = apiUpdateContextualBanditBody.parse(rawBody);
    const out: Partial<ContextualBanditInterface> = {};
    for (const field of CONTEXTUAL_BANDIT_API_UPDATE_FIELDS) {
      if (body[field] !== undefined) {
        // Cast: per-field types diverge enough that index assignment doesn't narrow through the loop.
        (out as Record<string, unknown>)[field] = body[field];
      }
    }
    if (body.datasource !== undefined) {
      out.datasourceId = body.datasource;
    }
    if (body.contextualAttributes !== undefined) {
      out.targetingAttributeColumns = body.contextualAttributes;
    }
    return out as Parameters<typeof this.updateById>[1];
  }

  /** Coerce missing CB-native fields to safe defaults so older on-disk docs read cleanly. */
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

  protected canRead(doc: ContextualBanditInterface): boolean {
    return this.context.permissions.canReadSingleProjectResource(doc.project);
  }

  protected canCreate(doc: ContextualBanditInterface): boolean {
    return this.context.permissions.canCreateContextualBandit(doc);
  }

  protected canUpdate(
    existing: ContextualBanditInterface,
    updated?: Partial<ContextualBanditInterface>,
  ): boolean {
    return this.context.permissions.canUpdateContextualBandit(
      existing,
      updated ?? existing,
    );
  }

  protected canDelete(doc: ContextualBanditInterface): boolean {
    return this.context.permissions.canDeleteContextualBandit(doc);
  }

  /** Atomically update `phases[i].currentLeafWeights` via positional `$set` so concurrent refreshes can't lose writes. */
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
    // Re-assert canUpdate because the atomic write below bypasses BaseModel.updateById's gate.
    if (!this.canUpdate(existing)) {
      this.context.permissions.throwPermissionError();
    }

    const collection = this._dangerousGetCollection();
    const now = new Date();
    const res = await collection.updateOne(
      {
        organization: this.context.org.id,
        id: cbId,
        // Guard against the phase being removed between the bounds check and this write.
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

  // Atomic linked-feature / pendingFeatureDraft updates; permission checks intentionally bypassed (sync runs post-auth).
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

  // $addToSet is atomic and idempotent on (featureId, revisionVersion); multiple drafts intentionally allowed.
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

  // Strip pending drafts for `featureId` on every CB not in `keepIds`.
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
      // Cast required: Mongo's $pull typing is invariant over the element shape.
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
}

/** Cross-org auto-snapshot agenda query; bypasses BaseModel in-org protections because the job has no org context. */
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

/** Cross-org scheduled-status agenda query: CBs whose `nextScheduledStatusUpdate.date` is due. */
export async function dangerousFindContextualBanditsWithScheduledStatusUpdate(): Promise<
  Pick<ContextualBanditInterface, "id" | "organization">[]
> {
  const now = new Date();
  const docs = await getCollection<ContextualBanditInterface>(COLLECTION)
    .find({
      "nextScheduledStatusUpdate.date": {
        $exists: true,
        $ne: null,
        $lte: now,
      },
    })
    .project<Pick<ContextualBanditInterface, "id" | "organization">>({
      id: true,
      organization: true,
    })
    .limit(100)
    .sort({ "nextScheduledStatusUpdate.date": 1 })
    .toArray();

  return docs.map((d) => ({ id: d.id, organization: d.organization }));
}
