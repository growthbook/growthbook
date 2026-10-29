import isEqual from "lodash/isEqual";
import { v4 as uuidv4 } from "uuid";
import {
  apiCreateInterleavingBody,
  apiUpdateInterleavingBody,
  ApiInterleavingInterface,
  INTERLEAVING_API_UPDATE_FIELDS,
  InterleavingInterface,
  interleavingApiSpec,
  interleavingValidator,
  startInterleavingEndpoint,
  stopInterleavingEndpoint,
} from "shared/validators";
import {
  assertUsableRankerSchema,
  generateVariationId,
  interleavingInSDKPayload,
  interleavingTargetingServes,
  parseInterleavingRankerConfig,
} from "shared/util";
import { interleavingEnvsForChange } from "shared/permissions";
import { isFactMetricId } from "shared/experiments";
import { UpdateProps } from "shared/types/base-model";
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
import { toApiInterleaving } from "back-end/src/enterprise/services/interleavingApi";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import { PAYLOAD_AFFECTING_INTERLEAVING_FIELDS } from "back-end/src/services/experimentPayloadFields";

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
        reqHandler: async (req) => {
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
        reqHandler: async (req) => {
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
    return {
      ...body,
      owner: await resolveOwnerForCreate(body.owner, this.context, {
        strict: true,
      }),
      tags: body.tags ?? [],
      archived: false,
      status: "draft" as const,
      trackingKey: body.trackingKey || body.key,
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
    if (changes.archived && existing.status === "running") {
      req.context.throwBadRequestError(
        "Stop this interleaving experiment before archiving it.",
      );
    }
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

  protected async customValidation(
    doc: InterleavingInterface,
    previousDoc?: InterleavingInterface,
  ): Promise<void> {
    const identityChanged =
      doc.key !== previousDoc?.key ||
      doc.trackingKey !== previousDoc?.trackingKey;
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
      const sharing = (
        await (
          this.context.scanContextOverride ??
          getContextForAgendaJobByOrgObject(this.context.org)
        ).models.interleavings.getAll()
      ).filter((il) => il.id !== doc.id && il.key === doc.key);

      if (interleavingInSDKPayload(doc)) {
        const serving = new Set(servingEnvs(doc));
        for (const other of sharing) {
          if (!interleavingInSDKPayload(other)) continue;
          const overlap = servingEnvs(other).filter((env) => serving.has(env));
          if (overlap.length) {
            throw new Error(
              `Another interleaving experiment with the key "${doc.key}" is already running in ${overlap.join(", ")}. Stop it, or turn that environment off for one of them.`,
            );
          }
        }
      }

      if (sharing.some((other) => other.trackingKey === doc.trackingKey)) {
        throw new Error(
          `Another interleaving experiment with the key "${doc.key}" already reports as "${doc.trackingKey}". Set a different tracking key so their exposures can be told apart.`,
        );
      }
    }

    if (
      doc.trackingKey !== previousDoc?.trackingKey &&
      !doc.trackingKey.trim()
    ) {
      throw new Error("Interleaving tracking key cannot be empty.");
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

    // Only re-validate metrics when they (or the datasource) change, so an
    // experiment whose metric was deleted later can still be edited.
    if (
      !previousDoc ||
      !isEqual(doc.metrics, previousDoc.metrics) ||
      doc.datasource !== previousDoc.datasource
    ) {
      const ids = doc.metrics.map((m) => m.id);
      if (new Set(ids).size !== ids.length) {
        throw new Error("Each metric can only be added once.");
      }
      for (const { id } of doc.metrics) {
        if (!isFactMetricId(id)) {
          throw new Error(`Interleaving metrics must be fact metrics: ${id}`);
        }
        const metric = await this.context.models.factMetrics.getById(id);
        if (!metric) {
          throw new Error(`Interleaving metric not found: ${id}`);
        }
        if (metric.datasource !== doc.datasource) {
          throw new Error(
            `Interleaving metric ${id} must belong to datasource ${doc.datasource}`,
          );
        }
        if (
          metric.metricType !== "mean" &&
          metric.metricType !== "proportion"
        ) {
          throw new Error(
            `Interleaving metrics must be mean or proportion metrics: ${id} is a ${metric.metricType} metric`,
          );
        }
      }
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

  protected async afterDelete(doc: InterleavingInterface) {
    this.refreshSDKPayload([doc], "deleted");
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
    // Editing a running interleaving's targeting, traffic or bucketing changes
    // what SDKs serve right away, the same as starting it, so it answers to the
    // same run permission. Drafts don't serve, so they stay on createAnalyses.
    const servesNow =
      interleavingInSDKPayload(existing) &&
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

  public getByInterleavingQueryId(
    interleavingQueryId: string,
  ): Promise<InterleavingInterface[]> {
    return this._find({ interleavingQueryId });
  }
}
