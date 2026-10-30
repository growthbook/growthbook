import isEqual from "lodash/isEqual";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import {
  apiCreateInterleavingBody,
  apiInterleavingLifecycleReturn,
  apiInterleavingResultsReturn,
  apiInterleavingSnapshotReturn,
  apiInterleavingSnapshotsReturn,
  apiInterleavingStatusReturn,
  apiUpdateInterleavingBody,
  ApiInterleavingInterface,
  getInterleavingResultsEndpoint,
  getInterleavingSnapshotEndpoint,
  getInterleavingStatusEndpoint,
  INTERLEAVING_API_UPDATE_FIELDS,
  InterleavingInterface,
  interleavingApiSpec,
  interleavingValidator,
  listInterleavingSnapshotsEndpoint,
  refreshInterleavingEndpoint,
  startInterleavingEndpoint,
  stopInterleavingEndpoint,
} from "shared/validators";
import {
  assertUsableRankerSchema,
  generateVariationId,
  interleavingInSDKPayload,
  interleavingTargetingServes,
  nextAvailableTrackingKey,
  parseInterleavingRankerConfig,
} from "shared/util";
import { interleavingEnvsForChange } from "shared/permissions";
import { CreateProps, UpdateProps } from "shared/types/base-model";
import { MakeModelClass } from "back-end/src/models/BaseModel";
import { validateChangedRuleReferences } from "back-end/src/api/features/validations";
import { assertValidExperimentPrerequisites } from "back-end/src/services/prerequisiteParents";
import { assertRegisteredAttributes } from "back-end/src/services/attributes";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { getInterleavingPayloadKeys } from "back-end/src/util/interleavings";
import { defineCustomApiHandler } from "back-end/src/api/apiModelHandlers";
import {
  resolveOwnerEmail,
  resolveOwnerEmails,
  resolveOwnerForCreate,
  resolveOwnerToUserId,
} from "back-end/src/services/owner";
import {
  interleavingChangeActions,
  pinnedFields,
  plainWriteSummary,
  requireConfirmation,
} from "back-end/src/services/confirmations";
import {
  startInterleaving,
  stopInterleaving,
} from "back-end/src/enterprise/services/interleavingChanges";
import {
  toApiInterleaving,
  toApiInterleavingSnapshot,
  toApiInterleavingSnapshotStatus,
} from "back-end/src/enterprise/services/interleavingApi";
import {
  cancelInterleavingSnapshot,
  resolveInterleavingExposureQuery,
  runInterleavingSnapshot,
} from "back-end/src/enterprise/services/interleavingAnalysis";
import { resolveInterleavingMetrics } from "back-end/src/enterprise/services/interleavingMetrics";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import { PAYLOAD_AFFECTING_INTERLEAVING_FIELDS } from "back-end/src/services/experimentPayloadFields";
import {
  ensureIndexOnce,
  getCollection,
  isDuplicateKeyErrorForIndex,
} from "back-end/src/util/mongo.util";

type ApiVariationInput = NonNullable<
  ReturnType<typeof apiUpdateInterleavingBody.parse>["variations"]
>[number];
type ApiJSONSchemaInput = NonNullable<
  ReturnType<typeof apiUpdateInterleavingBody.parse>["jsonSchema"]
>;

function payloadAffectingChanges(
  existing: InterleavingInterface,
  changes?: Partial<InterleavingInterface>,
): (keyof InterleavingInterface)[] {
  if (!changes) return [];
  return PAYLOAD_AFFECTING_INTERLEAVING_FIELDS.filter(
    (field) => field in changes && !isEqual(changes[field], existing[field]),
  );
}

const trackingKeyCollisionMessage = (trackingKey: string) =>
  `Another interleaving experiment already reports as "${trackingKey}" in this Data Source. Set a different tracking key so their exposures can be told apart.`;

const TRACKING_KEY_INDEX = "interleaving_datasource_trackingkey_unique";
const trackingKeyUniquenessIndex = {
  name: TRACKING_KEY_INDEX,
  unique: true,
} as const;

async function ensureTrackingKeyIndex() {
  await ensureIndexOnce(
    getCollection("interleavings"),
    { organization: 1, datasource: 1, trackingKey: 1 },
    trackingKeyUniquenessIndex,
  );
}

function toJSONSchema(
  input: ApiJSONSchemaInput | null | undefined,
): InterleavingInterface["jsonSchema"] {
  return input ? { ...input, date: new Date() } : null;
}

const BaseClass = MakeModelClass({
  schema: interleavingValidator,
  collectionName: "interleavings",
  idPrefix: "il_",
  globallyUniquePrimaryKeys: true,
  defaultValues: {
    owner: "",
    tags: [],
    archived: false,
    metrics: [],
    jsonSchema: null,
    environmentSettings: {},
  },
  auditLog: {
    entity: "interleaving",
    createEvent: "interleaving.create",
    updateEvent: "interleaving.update",
    deleteEvent: "interleaving.delete",
  },
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        key: 1,
      },
    },
    {
      fields: {
        organization: 1,
        trackingKey: 1,
      },
    },
  ],
  apiConfig: {
    modelKey: "interleavings",
    openApiSpec: interleavingApiSpec,
    customHandlers: [
      defineCustomApiHandler({
        ...startInterleavingEndpoint,
        reqHandler: async (
          req,
        ): Promise<z.infer<typeof apiInterleavingLifecycleReturn>> => {
          const interleaving = await req.context.models.interleavings.getById(
            req.params.id,
          );
          if (!interleaving) {
            return req.context.throwNotFoundError(
              `Interleaving experiment ${req.params.id} not found or not accessible`,
            );
          }
          const updated = await startInterleaving(req.context, interleaving);
          return {
            interleaving: await resolveOwnerEmail(
              toApiInterleaving(updated),
              req.context,
            ),
          };
        },
      }),
      defineCustomApiHandler({
        ...stopInterleavingEndpoint,
        reqHandler: async (
          req,
        ): Promise<z.infer<typeof apiInterleavingLifecycleReturn>> => {
          const interleaving = await req.context.models.interleavings.getById(
            req.params.id,
          );
          if (!interleaving) {
            return req.context.throwNotFoundError(
              `Interleaving experiment ${req.params.id} not found or not accessible`,
            );
          }
          const updated = await stopInterleaving(req.context, interleaving);
          return {
            interleaving: await resolveOwnerEmail(
              toApiInterleaving(updated),
              req.context,
            ),
          };
        },
      }),
      defineCustomApiHandler({
        ...refreshInterleavingEndpoint,
        // Existence, plan, and query permissions are checked by the service
        reqHandler: async (
          req,
        ): Promise<z.infer<typeof apiInterleavingSnapshotReturn>> => ({
          snapshot: toApiInterleavingSnapshot(
            await runInterleavingSnapshot(req.context, req.params.id),
          ),
        }),
      }),
      defineCustomApiHandler({
        ...getInterleavingResultsEndpoint,
        reqHandler: async (
          req,
        ): Promise<z.infer<typeof apiInterleavingResultsReturn>> => {
          const interleaving = await req.context.models.interleavings.getById(
            req.params.id,
          );
          if (!interleaving) {
            return req.context.throwNotFoundError(
              `Interleaving experiment ${req.params.id} not found or not accessible`,
            );
          }
          const [snapshot, latest] = await Promise.all([
            req.context.models.interleavingSnapshots.getLatestSuccessfulForInterleaving(
              interleaving.id,
            ),
            req.context.models.interleavingSnapshots.getLatestForInterleaving(
              interleaving.id,
            ),
          ]);
          return {
            snapshot: snapshot ? toApiInterleavingSnapshot(snapshot) : null,
            latest: latest ? toApiInterleavingSnapshotStatus(latest) : null,
          };
        },
      }),
      defineCustomApiHandler({
        ...getInterleavingStatusEndpoint,
        reqHandler: async (
          req,
        ): Promise<z.infer<typeof apiInterleavingStatusReturn>> => {
          const interleaving = await req.context.models.interleavings.getById(
            req.params.id,
          );
          if (!interleaving) {
            return req.context.throwNotFoundError(
              `Interleaving experiment ${req.params.id} not found or not accessible`,
            );
          }
          const latest =
            await req.context.models.interleavingSnapshots.getLatestStatusForInterleaving(
              interleaving.id,
            );
          return {
            latest: latest ? toApiInterleavingSnapshotStatus(latest) : null,
          };
        },
      }),
      defineCustomApiHandler({
        ...listInterleavingSnapshotsEndpoint,
        reqHandler: async (
          req,
        ): Promise<z.infer<typeof apiInterleavingSnapshotsReturn>> => {
          const interleaving = await req.context.models.interleavings.getById(
            req.params.id,
          );
          if (!interleaving) {
            return req.context.throwNotFoundError(
              `Interleaving experiment ${req.params.id} not found or not accessible`,
            );
          }
          const snapshots =
            await req.context.models.interleavingSnapshots.listForInterleaving(
              interleaving.id,
              req.query.limit,
            );
          return { snapshots: snapshots.map(toApiInterleavingSnapshot) };
        },
      }),
      defineCustomApiHandler({
        ...getInterleavingSnapshotEndpoint,
        reqHandler: async (
          req,
        ): Promise<z.infer<typeof apiInterleavingSnapshotReturn>> => {
          // Load the parent first: snapshots carry no project of their own, so
          // the interleaving's current project is what authorizes the read.
          const interleaving = await req.context.models.interleavings.getById(
            req.params.id,
          );
          if (!interleaving) {
            return req.context.throwNotFoundError(
              `Interleaving experiment ${req.params.id} not found or not accessible`,
            );
          }
          const snapshot =
            await req.context.models.interleavingSnapshots.getById(
              req.params.snapshotId,
            );
          if (!snapshot || snapshot.interleavingId !== interleaving.id) {
            return req.context.throwNotFoundError(
              `Snapshot ${req.params.snapshotId} not found on interleaving experiment ${req.params.id}`,
            );
          }
          return { snapshot: toApiInterleavingSnapshot(snapshot) };
        },
      }),
    ],
  },
});

export class InterleavingModel extends BaseClass {
  protected toApiInterface(
    doc: InterleavingInterface,
  ): ApiInterleavingInterface {
    return toApiInterleaving(doc);
  }

  public override async handleApiList(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiList"]>[0],
  ): Promise<ApiInterleavingInterface[]> {
    const { projectId, datasourceId, trackingKey, key } = req.query;
    const filter: Record<string, string> = {};
    if (projectId) filter.project = projectId;
    if (datasourceId) filter.datasource = datasourceId;
    if (trackingKey) filter.trackingKey = trackingKey;
    if (key) filter.key = key;
    const docs = Object.keys(filter).length
      ? await this._find(filter)
      : await this.getAll();
    return resolveOwnerEmails(
      docs.map((doc) => this.toApiInterface(doc)),
      this.context,
    );
  }

  protected async processApiCreateBody(rawBody: unknown) {
    const body = apiCreateInterleavingBody.parse(rawBody);
    const [a, b] = body.variations;
    // An explicit tracking key is honoured as given; customValidation rejects it
    // if taken. Otherwise suffix the code key so reusing one to iterate works.
    const trackingKey =
      body.trackingKey ||
      nextAvailableTrackingKey(
        body.key,
        new Set(
          (await this.scanAllInterleavings())
            .filter((il) => il.datasource === body.datasource)
            .map((il) => il.trackingKey),
        ),
      );
    return {
      ...body,
      owner: await resolveOwnerForCreate(body.owner, this.context, {
        strict: true,
      }),
      tags: body.tags ?? [],
      archived: false,
      status: "draft" as const,
      trackingKey,
      hashAttribute: body.hashAttribute || "id",
      seed: uuidv4(),
      variations: [
        { ...a, id: generateVariationId() },
        { ...b, id: generateVariationId() },
      ] as InterleavingInterface["variations"],
      jsonSchema: toJSONSchema(body.jsonSchema),
      metrics: body.metrics ?? [],
      environmentSettings: body.environmentSettings ?? {},
    };
  }

  private async apiUpdateChanges(
    existing: InterleavingInterface,
    rawBody: unknown,
  ): Promise<UpdateProps<InterleavingInterface>> {
    const body = apiUpdateInterleavingBody.parse(rawBody);
    const changes: UpdateProps<InterleavingInterface> = {};
    for (const field of INTERLEAVING_API_UPDATE_FIELDS) {
      if (body[field] !== undefined) {
        (changes as Record<string, unknown>)[field] = body[field];
      }
    }
    if (body.owner !== undefined) {
      const owner = await resolveOwnerToUserId(body.owner, this.context, {
        strict: true,
      });
      if (!owner) this.context.throwBadRequestError("`owner` cannot be empty.");
      changes.owner = owner;
    }
    if (body.variations) {
      const withId = (v: ApiVariationInput, i: number) => ({
        ...v,
        id: existing.variations[i].id,
      });
      changes.variations = [
        withId(body.variations[0], 0),
        withId(body.variations[1], 1),
      ];
    }
    if (body.jsonSchema !== undefined) {
      changes.jsonSchema = toJSONSchema(body.jsonSchema);
    }
    return changes;
  }

  // Holds for confirmation by what the update changes about how it serves.
  public override async handleApiUpdate(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiUpdate"]>[0],
  ): Promise<ApiInterleavingInterface> {
    const { id } = req.params as { id: string };
    const existing = await this.getById(id);
    if (!existing) return req.context.throwNotFoundError();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const changes = await this.apiUpdateChanges(existing, body);
    await requireConfirmation(req.context, {
      actions: interleavingChangeActions(existing, changes),
      project: existing.project,
      summary:
        plainWriteSummary(
          "put",
          "/interleavings/:id",
          "interleaving experiment",
          existing.name,
          body,
        ) ?? `Update ${existing.name}`,
      links: [],
      pin: [existing.status, pinnedFields(existing, changes)],
    });
    return resolveOwnerEmail(
      this.toApiInterface(await this.update(existing, changes)),
      this.context,
    );
  }

  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("interleaving");
  }

  private async mapTrackingKeyCollision<T>(
    doc: { trackingKey: string },
    write: () => Promise<T>,
  ): Promise<T> {
    try {
      return await write();
    } catch (e) {
      if (isDuplicateKeyErrorForIndex(e, TRACKING_KEY_INDEX)) {
        throw new Error(trackingKeyCollisionMessage(doc.trackingKey));
      }
      throw e;
    }
  }

  public create(props: CreateProps<InterleavingInterface>) {
    return this.mapTrackingKeyCollision(props, () => super.create(props));
  }

  public update(
    existing: InterleavingInterface,
    updates: UpdateProps<InterleavingInterface>,
  ) {
    return this.mapTrackingKeyCollision(
      { trackingKey: updates.trackingKey ?? existing.trackingKey },
      () => super.update(existing, updates),
    );
  }

  // Admin context so the scan is not permission-filtered: a tracking key the
  // caller cannot read still collides.
  private async scanAllInterleavings(): Promise<InterleavingInterface[]> {
    return (
      this.context.scanContextOverride ??
      getContextForAgendaJobByOrgObject(this.context.org)
    ).models.interleavings.getAll();
  }

  protected async customValidation(
    doc: InterleavingInterface,
    previousDoc?: InterleavingInterface,
  ): Promise<void> {
    const identityChanged =
      doc.key !== previousDoc?.key ||
      doc.trackingKey !== previousDoc?.trackingKey ||
      doc.datasource !== previousDoc?.datasource;
    const servingChanged =
      doc.status !== previousDoc?.status ||
      doc.archived !== previousDoc?.archived ||
      !isEqual(doc.environmentSettings, previousDoc?.environmentSettings);
    if (identityChanged || servingChanged) {
      const servingEnvs = (il: InterleavingInterface) =>
        interleavingEnvsForChange({
          existing: il,
          environmentIds: this.context.environments,
        });
      const others = (await this.scanAllInterleavings()).filter(
        (il) => il.id !== doc.id,
      );

      // Serving conflict, so only running experiments matter, and only where
      // they actually serve.
      if (interleavingInSDKPayload(doc)) {
        const serving = new Set(servingEnvs(doc));
        for (const other of others.filter((il) => il.key === doc.key)) {
          if (!interleavingInSDKPayload(other)) continue;
          const overlap = servingEnvs(other).filter((env) => serving.has(env));
          if (overlap.length) {
            throw new Error(
              `Another interleaving experiment with the key "${doc.key}" is already running in ${overlap.join(", ")}. Stop it, or turn that environment off for one of them.`,
            );
          }
        }
      }

      if (identityChanged) {
        await ensureTrackingKeyIndex();
      }
      if (
        identityChanged &&
        others.some(
          (other) =>
            other.datasource === doc.datasource &&
            other.trackingKey === doc.trackingKey,
        )
      ) {
        throw new Error(trackingKeyCollisionMessage(doc.trackingKey));
      }
    }

    if (
      doc.trackingKey !== previousDoc?.trackingKey &&
      !doc.trackingKey.trim()
    ) {
      throw new Error("Interleaving tracking key cannot be empty.");
    }

    // These rebucket every user mid-flight, which invalidates the experiment
    // rather than adjusting it. trackingKey is deliberately not locked: it only
    // changes which experiment_id later exposures carry, so the damage is
    // contained to this experiment's own results.
    if (previousDoc?.status === "running") {
      const locked = (
        [
          ["seed", "seed"],
          ["hashAttribute", "assignment attribute"],
        ] as const
      )
        .filter(([field]) => doc[field] !== previousDoc[field])
        .map(([, label]) => label);
      if (locked.length) {
        throw new Error(
          `Stop this interleaving experiment before changing its ${locked.join(
            ", ",
          )}.`,
        );
      }
    }

    if (
      !previousDoc ||
      !isEqual(doc.variations, previousDoc.variations) ||
      !isEqual(doc.jsonSchema, previousDoc.jsonSchema)
    ) {
      const [a, b] = doc.variations;
      if (a.key === b.key) {
        throw new Error("The two rankers must have different keys.");
      }
      if (a.id === b.id) {
        throw new Error("The two rankers must have different ids.");
      }
      // Before the loop, so a bad schema isn't reported against a ranker.
      assertUsableRankerSchema(doc.jsonSchema);
      for (const v of doc.variations) {
        try {
          parseInterleavingRankerConfig(v.config, doc.jsonSchema);
        } catch (e) {
          throw new Error(
            `Ranker "${v.name || v.key}": ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }

    // Only re-validate metrics when they (or what they're read with) change,
    // so an experiment whose metric was deleted later can still be edited.
    if (
      !previousDoc ||
      !isEqual(doc.metrics, previousDoc.metrics) ||
      doc.datasource !== previousDoc.datasource ||
      doc.userIdType !== previousDoc.userIdType
    ) {
      await resolveInterleavingMetrics(this.context, {
        datasourceId: doc.datasource,
        userIdType: doc.userIdType,
        metrics: doc.metrics,
      });
    }

    const starting =
      doc.status === "running" && previousDoc?.status !== "running";
    if (
      !previousDoc ||
      starting ||
      doc.interleavingExposureQueryId !==
        previousDoc.interleavingExposureQueryId ||
      doc.datasource !== previousDoc.datasource ||
      doc.userIdType !== previousDoc.userIdType
    ) {
      await resolveInterleavingExposureQuery(this.context, doc);
    }

    if (
      !previousDoc ||
      !isEqual(
        Object.keys(doc.environmentSettings).sort(),
        Object.keys(previousDoc.environmentSettings).sort(),
      )
    ) {
      const orgEnvs = new Set(this.context.environments);
      const unknown = Object.keys(doc.environmentSettings).filter(
        (env) => !orgEnvs.has(env),
      );
      if (unknown.length) {
        throw new Error(`Unknown environments: ${unknown.join(", ")}`);
      }
    }

    // Targeting reaches the SDK payload as the pseudo flag's rule, so it gets
    // the feature-rule write checks (changed fields only), as CBs do.
    // A stopped interleaving doesn't block deleting the saved groups and
    // features its targeting names, so everything is re-checked on the way back
    // to serving — a dangling reference silently flips a `none` match open.
    const goingLive =
      !!previousDoc &&
      !interleavingTargetingServes(previousDoc) &&
      interleavingTargetingServes(doc);
    const referenceContext = goingLive
      ? (this.context.scanContextOverride ??
        getContextForAgendaJobByOrgObject(this.context.org))
      : this.context;
    await validateChangedRuleReferences(
      [doc],
      previousDoc && !goingLive ? [previousDoc] : [],
      referenceContext,
    );
    await assertValidExperimentPrerequisites(
      referenceContext,
      doc.prerequisites,
      goingLive ? undefined : previousDoc?.prerequisites,
    );
    assertRegisteredAttributes(
      this.context,
      { hashAttribute: doc.hashAttribute, condition: doc.condition },
      "interleaving experiment",
      previousDoc && {
        hashAttribute: previousDoc.hashAttribute,
        condition: previousDoc.condition,
      },
      doc.project || undefined,
    );
  }

  protected async afterCreate(doc: InterleavingInterface) {
    this.refreshSDKPayload([doc], "created");
  }

  protected async afterUpdate(
    existing: InterleavingInterface,
    updates: UpdateProps<InterleavingInterface>,
    newDoc: InterleavingInterface,
  ) {
    if (!payloadAffectingChanges(existing, updates).length) return;
    this.refreshSDKPayload([existing, newDoc], "updated");
  }

  protected async beforeDelete(doc: InterleavingInterface) {
    if (interleavingInSDKPayload(doc)) {
      throw new Error(
        "Stop or archive this interleaving experiment before deleting it.",
      );
    }
    // A stopped or archived experiment can still have a refresh in flight.
    // Dropping its snapshots would orphan the warehouse queries and the
    // reaper that finalizes them keys off the snapshot doc, so cancel first.
    const cancelContext =
      this.context.scanContextOverride ??
      getContextForAgendaJobByOrgObject(this.context.org);
    const running =
      await cancelContext.models.interleavingSnapshots.listActiveForInterleaving(
        doc.id,
      );
    for (const snapshot of running) {
      try {
        await cancelInterleavingSnapshot(cancelContext, snapshot);
      } catch (e) {
        // Best effort: an unreachable warehouse must not make the experiment
        // undeletable. afterDelete still removes the snapshot documents.
        this.context.logger.error(
          e,
          `Failed to cancel interleaving snapshot ${snapshot.id} while deleting ${doc.id}`,
        );
      }
    }
  }

  protected async afterDelete(doc: InterleavingInterface) {
    this.refreshSDKPayload([doc], "deleted");
    // Orphaned snapshots are not just dead weight: the reapers scan the
    // collection by status with no parent check, so a running one is retried
    // forever. Deleted unchecked because `delete()` enforces
    // canRunExperimentQueries, which the user deleting the parent may not hold
    // — and throwing here would strand them after the parent is already gone.
    await this.context.models.interleavingSnapshots.deleteAllForInterleaving(
      doc.id,
    );
  }

  private refreshSDKPayload(docs: InterleavingInterface[], event: string) {
    const payloadKeys = getInterleavingPayloadKeys(
      docs.filter(interleavingInSDKPayload),
      this.context.environments,
    );
    if (!payloadKeys.length) return;
    queueSDKPayloadRefresh({
      context: this.context,
      payloadKeys,
      auditContext: { event, model: "interleaving", id: docs[0].id },
    });
  }

  protected canRead(doc: InterleavingInterface): boolean {
    return this.context.permissions.canReadSingleProjectResource(doc.project);
  }

  protected canCreate(doc: InterleavingInterface): boolean {
    const envs = interleavingEnvsForChange({
      existing: doc,
      environmentIds: this.context.environments,
    });
    if (
      envs.length > 0 &&
      !this.context.permissions.canRunInterleaving(doc, envs)
    ) {
      return false;
    }
    return this.context.permissions.canCreateInterleaving(doc);
  }

  protected canUpdate(
    existing: InterleavingInterface,
    updated?: Partial<InterleavingInterface>,
  ): boolean {
    const statusChanged =
      updated?.status !== undefined && updated.status !== existing.status;
    const envsChanged =
      updated?.environmentSettings !== undefined &&
      !isEqual(updated.environmentSettings, existing.environmentSettings);
    // Live payload changes require the same permission as starting.
    const servesNow =
      (interleavingInSDKPayload(existing) ||
        interleavingInSDKPayload({ ...existing, ...updated })) &&
      payloadAffectingChanges(existing, updated).length > 0;
    const envs = interleavingEnvsForChange({
      existing,
      updated,
      environmentIds: this.context.environments,
    });
    if (
      (statusChanged || envsChanged || servesNow) &&
      envs.length > 0 &&
      !this.context.permissions.canRunInterleavingUpdate(
        existing,
        updated ?? existing,
        envs,
      )
    ) {
      return false;
    }
    return this.context.permissions.canUpdateInterleaving(
      existing,
      updated ?? existing,
    );
  }

  protected canDelete(doc: InterleavingInterface): boolean {
    return this.context.permissions.canDeleteInterleaving(doc);
  }

  public getAllPayloadInterleavings(): Promise<InterleavingInterface[]> {
    return this._find({
      archived: false,
      status: "running",
    });
  }

  public getByInterleavingExposureQueryId(
    interleavingExposureQueryId: string,
  ): Promise<InterleavingInterface[]> {
    return this._find({ interleavingExposureQueryId });
  }

  // Every interleaving in the org referencing the query, ignoring the caller's
  // read permissions. Only for authoritative dependency scans: deleting an
  // exposure query is gated on the datasource, which is shared across projects,
  // so missing a reference in a project the caller cannot read would let the
  // delete through and strand that experiment. Never return these to the
  // caller.
  public dangerousGetAllByExposureQueryIdForDependencyScan(
    interleavingExposureQueryId: string,
  ): Promise<InterleavingInterface[]> {
    return this._find(
      { interleavingExposureQueryId },
      { bypassReadPermissionChecks: true },
    );
  }

  /** Looks up an interleaving by its code-facing key (what `interleave()` receives). */
  public getByKey(key: string): Promise<InterleavingInterface | null> {
    return this._findOne({ key });
  }
}
