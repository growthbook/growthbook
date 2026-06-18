import { z } from "zod";
import {
  apiContextualBanditLifecycleReturn,
  apiContextualBanditRefreshReturn,
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
  defaultValues: {
    holdoutPercent: 0,
    archived: false,
    minUsersPerLeaf: 100,
    maxLeaves: 12,
    canonicalFormVersion: 1,
    currentLeafWeights: [],
    banditVersion: 0,
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
        reqHandler: async (
          req,
        ): Promise<z.infer<typeof apiContextualBanditLifecycleReturn>> => {
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
        reqHandler: async (
          req,
        ): Promise<z.infer<typeof apiContextualBanditLifecycleReturn>> => {
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
        reqHandler: async (
          req,
        ): Promise<z.infer<typeof apiContextualBanditRefreshReturn>> => {
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
          return runContextualBanditSnapshot(req.context, cb, {
            triggeredBy: "manual",
          });
        },
      }),
    ],
  },
});

export function toApiContextualBandit(
  doc: ContextualBanditInterface,
): ApiContextualBanditInterface {
  return {
    id: doc.id,
    dateCreated: doc.dateCreated.toISOString(),
    dateUpdated: doc.dateUpdated.toISOString(),
    name: doc.name,
    description: doc.description,
    project: doc.project,
    owner: doc.owner,
    tags: doc.tags,
    archived: doc.archived,
    status: doc.status,
    dateStarted: doc.dateStarted?.toISOString(),
    dateStopped: doc.dateStopped?.toISOString(),
    trackingKey: doc.trackingKey,
    hashAttribute: doc.hashAttribute,
    variations: doc.variations.map((v) => ({
      id: v.id,
      key: v.key,
      name: v.name,
      description: v.description,
    })),
    datasource: doc.datasource,
    contextualBanditQueryId: doc.contextualBanditQueryId,
    queryFilter: doc.queryFilter,
    activationMetric: doc.activationMetric,
    skipPartialData: doc.skipPartialData,
    regressionAdjustmentEnabled: doc.regressionAdjustmentEnabled,
    coverage: doc.coverage,
    condition: doc.condition,
    seed: doc.seed,
    variationWeights: doc.variationWeights,
    currentLeafWeights: doc.currentLeafWeights ?? [],
    contextualAttributes: doc.contextualAttributes,
    decisionMetric: doc.decisionMetric,
    minUsersPerLeaf: doc.minUsersPerLeaf,
    maxLeaves: doc.maxLeaves,
    holdoutPercent: doc.holdoutPercent,
    canonicalFormVersion: doc.canonicalFormVersion,
    banditVersion: doc.banditVersion ?? 0,
  };
}

export class ContextualBanditModel extends BaseClass {
  protected toApiInterface(
    doc: ContextualBanditInterface,
  ): ApiContextualBanditInterface {
    return toApiContextualBandit(doc);
  }

  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("contextual-bandits");
  }

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

  protected async processApiCreateBody(rawBody: unknown) {
    const body = apiCreateContextualBanditBody.parse(rawBody);
    const orgPrior = this.context.org.settings?.metricDefaults?.priorSettings;

    return {
      ...body,
      tags: body.tags ?? [],
      owner: body.owner ?? "",
      archived: false,
      holdoutPercent: 0,
      canonicalFormVersion: 1,
      minUsersPerLeaf: body.minUsersPerLeaf ?? 100,
      maxLeaves: body.maxLeaves ?? 12,
      hashAttribute: body.hashAttribute ?? "id",
      // Backfill per-variation id/screenshots so the internal validator accepts the doc.
      variations: body.variations.map((v) => ({
        ...v,
        id: generateVariationId(),
        screenshots: [],
      })),
      // `datasourceId`/`targetingAttributeColumns` mirror `datasource`/`contextualAttributes` for the snapshot orchestrator.
      datasourceId: body.datasource,
      targetingAttributeColumns: body.contextualAttributes,
      contextualAttributes: body.contextualAttributes,
      status: "draft" as const,
      // First successful snapshot writes the leaf weights; `dateStarted` is set by the `start` action.
      currentLeafWeights: [],
      banditVersion: 0,
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

  public async patchLeafWeights(
    cbId: string,
    leafWeights: LeafWeight[],
  ): Promise<ContextualBanditInterface> {
    const existingCB = await this.getById(cbId);
    if (!existingCB) {
      throw new Error(`ContextualBandit not found: ${cbId}`);
    }
    // Re-assert canUpdate because the atomic write below bypasses BaseModel.updateById's gate.
    if (!this.canUpdate(existingCB)) {
      this.context.permissions.throwPermissionError();
    }

    // this runs in the snapshot/cron path and needs the dangerous method for performance
    const collection = this._dangerousGetCollection();
    const now = new Date();
    const set: Record<string, unknown> = { dateUpdated: now };
    // Skip writing currentLeafWeights when empty so an empty-result run can't wipe existing weights.
    if (leafWeights.length > 0) {
      set.currentLeafWeights = leafWeights;
    }
    const res = await collection.updateOne(
      {
        organization: this.context.org.id,
        id: cbId,
      },
      {
        $set: set,
        $inc: { banditVersion: 1 },
      },
    );
    if (res.matchedCount === 0) {
      throw new Error(
        `ContextualBandit ${cbId} currentLeafWeights could not be updated`,
      );
    }

    const refreshed = await this.getById(cbId);
    if (!refreshed) {
      throw new Error(`ContextualBandit ${cbId} disappeared after update`);
    }
    return refreshed;
  }

  public async addLinkedFeature(
    cbId: string,
    featureId: string,
  ): Promise<void> {
    const cb = await this.getById(cbId);
    if (!cb) return;
    if (cb.linkedFeatures?.includes(featureId)) return;
    await this.update(cb, {
      linkedFeatures: [...(cb.linkedFeatures ?? []), featureId],
    });
  }

  public async removeLinkedFeature(
    cbId: string,
    featureId: string,
  ): Promise<void> {
    const cb = await this.getById(cbId);
    if (!cb || !cb.linkedFeatures?.includes(featureId)) return;
    await this.update(cb, {
      linkedFeatures: cb.linkedFeatures.filter((f) => f !== featureId),
    });
  }

  public async addPendingFeatureDraft(
    cbId: string,
    featureId: string,
    revisionVersion: number,
  ): Promise<void> {
    const cb = await this.getById(cbId);
    if (!cb) return;
    const drafts = cb.pendingFeatureDrafts ?? [];
    if (
      drafts.some(
        (d) =>
          d.featureId === featureId && d.revisionVersion === revisionVersion,
      )
    ) {
      return;
    }
    await this.update(cb, {
      pendingFeatureDrafts: [...drafts, { featureId, revisionVersion }],
    });
  }

  public async removePendingFeatureDraft(
    cbId: string,
    featureId: string,
    revisionVersion?: number,
  ): Promise<void> {
    const cb = await this.getById(cbId);
    if (!cb) return;
    const drafts = cb.pendingFeatureDrafts ?? [];
    const remaining = drafts.filter((d) =>
      revisionVersion != null
        ? !(d.featureId === featureId && d.revisionVersion === revisionVersion)
        : d.featureId !== featureId,
    );
    if (remaining.length === drafts.length) return;
    await this.update(cb, {
      pendingFeatureDrafts: remaining,
    });
  }

  // Strip pending drafts for `featureId` on every CB not in `keepIds`.
  public async clearStalePendingFeatureDrafts(
    featureId: string,
    keepIds: string[],
  ): Promise<void> {
    const keep = new Set(keepIds);
    const contextualbandits = await this._find({
      "pendingFeatureDrafts.featureId": featureId,
    });
    await Promise.all(
      contextualbandits
        .filter((cb: ContextualBanditInterface) => !keep.has(cb.id))
        .map((cb: ContextualBanditInterface) =>
          this.update(cb, {
            pendingFeatureDrafts: (cb.pendingFeatureDrafts ?? []).filter(
              (d) => d.featureId !== featureId,
            ),
          }),
        ),
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
