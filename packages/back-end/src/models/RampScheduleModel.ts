import { v4 as uuidv4 } from "uuid";
import { UpdateProps } from "shared/types/base-model";
import type { FeatureInterface } from "shared/types/feature";
import {
  ApiRampScheduleInterface,
  RampScheduleInterface,
  RampScheduleTemplateInterface,
  RampStepAction,
  rampScheduleValidator,
} from "shared/validators";
import { rampScheduleApiSpec } from "back-end/src/api/specs/ramp-schedule.spec";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  computeNextProcessAt,
  dispatchRampEvent,
} from "back-end/src/services/rampSchedule";
import { getCollection } from "back-end/src/util/mongo.util";
import { applyPagination } from "back-end/src/util/handler";
import { MakeModelClass } from "./BaseModel";

export const COLLECTION_NAME = "rampschedules";

const BaseClass = MakeModelClass({
  schema: rampScheduleValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: "rs_",
  auditLog: {
    entity: "rampSchedule",
    createEvent: "rampSchedule.create",
    updateEvent: "rampSchedule.update",
    deleteEvent: "rampSchedule.delete",
  },
  globallyUniquePrimaryKeys: true,
  defaultValues: {
    status: "pending" as const,
    currentStepIndex: -1,
    nextStepAt: null,
    nextProcessAt: null,
  },
  apiConfig: {
    modelKey: "rampSchedules",
    openApiSpec: rampScheduleApiSpec,
  },
});

// --- Date serialization helpers ---

function dateToIso(d: Date | null | undefined): string | null | undefined {
  if (d === null) return null;
  if (d === undefined) return undefined;
  return d.toISOString();
}

function serializeTrigger(
  trigger: RampScheduleInterface["steps"][number]["trigger"],
) {
  switch (trigger.type) {
    case "scheduled":
      return { type: "scheduled" as const, at: trigger.at.toISOString() };
    case "interval":
      return { type: "interval" as const, seconds: trigger.seconds };
    case "approval":
      return { type: "approval" as const };
  }
}

/** Convert a RampScheduleInterface (Date objects) to the API shape (ISO strings). */
export function rampScheduleToApiInterface(
  doc: RampScheduleInterface,
): ApiRampScheduleInterface {
  return {
    id: doc.id,
    dateCreated: doc.dateCreated.toISOString(),
    dateUpdated: doc.dateUpdated.toISOString(),
    name: doc.name,
    entityType: doc.entityType,
    entityId: doc.entityId,
    targets: doc.targets,
    steps: doc.steps.map((s) => ({
      trigger: serializeTrigger(s.trigger),
      actions: s.actions,
      approvalNotes: s.approvalNotes,
    })),
    endActions: doc.endActions,
    startDate: dateToIso(doc.startDate),
    endCondition: doc.endCondition
      ? {
          trigger: doc.endCondition.trigger
            ? {
                type: "scheduled" as const,
                at: doc.endCondition.trigger.at.toISOString(),
              }
            : undefined,
        }
      : doc.endCondition,
    status: doc.status,
    currentStepIndex: doc.currentStepIndex,
    startedAt: dateToIso(doc.startedAt),
    phaseStartedAt: dateToIso(doc.phaseStartedAt),
    pausedAt: dateToIso(doc.pausedAt),
    nextStepAt: dateToIso(doc.nextStepAt) ?? null,
    nextProcessAt: dateToIso(doc.nextProcessAt),
    elapsedMs: doc.elapsedMs,
  };
}

// --- Create handler helpers ---

type ApiRampTrigger =
  | { type: "interval"; seconds: number }
  | { type: "approval" }
  | { type: "scheduled"; at: string };

type PostBodyAction = {
  targetType?: "feature-rule";
  targetId?: string;
  patch: Partial<RampStepAction["patch"]>;
};

function forceMatchesValueType(
  value: unknown,
  valueType: FeatureInterface["valueType"],
): boolean {
  if (value === null || value === undefined) return false;
  const t = typeof value;
  if (valueType === "boolean") return t === "boolean";
  if (valueType === "number") return t === "number";
  if (valueType === "string") return t === "string";
  if (valueType === "json") return t === "object";
  return false;
}

function remapTemplateActions(
  actions: RampScheduleTemplateInterface["steps"][number]["actions"],
  targetId: string,
  ruleId: string,
  valueType: FeatureInterface["valueType"],
): RampStepAction[] {
  return (actions ?? []).map((a) => {
    const patch = { ...a.patch, ruleId };
    if ("force" in patch && !forceMatchesValueType(patch.force, valueType)) {
      const { force: _force, ...rest } = patch;
      return { targetType: "feature-rule" as const, targetId, patch: rest };
    }
    return { targetType: "feature-rule" as const, targetId, patch };
  });
}

function normalizeApiTrigger(
  trigger: ApiRampTrigger,
): RampScheduleInterface["steps"][number]["trigger"] {
  if (trigger.type === "scheduled") {
    return { type: "scheduled", at: new Date(trigger.at) };
  }
  if (trigger.type === "interval") {
    return { type: "interval", seconds: trigger.seconds };
  }
  return { type: "approval" };
}

function normalizeAction(action: PostBodyAction): RampStepAction {
  return {
    targetType: "feature-rule" as const,
    targetId: action.targetId ?? "",
    patch: action.patch as RampStepAction["patch"],
  };
}

function injectTarget(
  action: PostBodyAction,
  targetId: string,
  ruleId: string,
): RampStepAction {
  return {
    targetType: "feature-rule" as const,
    targetId,
    patch: { ...action.patch, ruleId },
  };
}

// --- Model ---

export class RampScheduleModel extends BaseClass {
  private getProject(doc: RampScheduleInterface): string | undefined {
    const { feature } = this.getForeignRefs(doc, false);
    return feature?.project;
  }

  protected canRead(doc: RampScheduleInterface) {
    return this.context.permissions.canReadSingleProjectResource(
      this.getProject(doc),
    );
  }
  protected canCreate(doc: RampScheduleInterface) {
    return this.context.permissions.canCreateFeature({
      project: this.getProject(doc),
    });
  }
  protected canUpdate(
    existing: RampScheduleInterface,
    _updates: UpdateProps<RampScheduleInterface>,
    newDoc: RampScheduleInterface,
  ) {
    return this.context.permissions.canUpdateFeature(
      { project: this.getProject(existing) },
      { project: this.getProject(newDoc) },
    );
  }
  protected canDelete(existing: RampScheduleInterface) {
    return this.context.permissions.canDeleteFeature({
      project: this.getProject(existing),
    });
  }

  // --- API interface ---

  protected toApiInterface(
    doc: RampScheduleInterface,
  ): ApiRampScheduleInterface {
    return rampScheduleToApiInterface(doc);
  }

  // --- CRUD handler overrides ---

  public override async handleApiList(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiList"]>[0],
  ) {
    let schedules: RampScheduleInterface[];

    if (req.query.featureId) {
      schedules = await this.getAllByFeatureId(req.query.featureId);
    } else {
      schedules = await this.getAll();
    }

    if (req.query.status) {
      schedules = schedules.filter((s) => s.status === req.query.status);
    }

    const { filtered, returnFields } = applyPagination(
      schedules.sort(
        (a, b) =>
          new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime(),
      ),
      req.query,
    );

    // TODO: clean this up and better support pagination in BaseModel list routes
    // When crudValidatorOverrides provides a responseSchema, the route handler
    // returns this value directly (hasResponseOverride) instead of wrapping it.
    return {
      rampSchedules: filtered.map((s) => this.toApiInterface(s)),
      ...returnFields,
    } as unknown as ReturnType<
      InstanceType<typeof BaseClass>["handleApiList"]
    > extends Promise<infer R>
      ? R
      : never;
  }

  public override async handleApiCreate(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiCreate"]>[0],
  ) {
    const body = req.body;

    if (!this.context.hasPremiumFeature("ramp-schedules")) {
      this.context.throwPlanDoesNotAllowError(
        "Ramp schedules require an Enterprise plan.",
      );
    }

    const hasTarget = !!(body.featureId && body.ruleId && body.environment);

    let targetId: string | undefined;
    let feature: FeatureInterface | null = null;

    if (body.featureId) {
      feature = await getFeature(this.context, body.featureId);
      if (!feature) {
        throw new Error(`Feature '${body.featureId}' not found`);
      }
    }

    if (hasTarget) {
      const envRules =
        feature!.environmentSettings?.[body.environment!]?.rules ?? [];
      const rule = envRules.find((r) => r.id === body.ruleId);
      if (!rule) {
        throw new Error(
          `Rule '${body.ruleId}' not found in environment '${body.environment}'. ` +
            `The rule must be published before attaching a ramp schedule.`,
        );
      }

      const conflicting = await this.findByTargetRule(
        body.ruleId!,
        body.environment!,
      );
      if (conflicting.length > 0) {
        throw new Error(
          `A ramp schedule (${conflicting[0].id}) already controls rule '${body.ruleId}' ` +
            `in environment '${body.environment}'. Delete it first before creating a new one.`,
        );
      }

      targetId = uuidv4();
    }

    let template: RampScheduleTemplateInterface | undefined;
    if (body.templateId) {
      const tmpl = await this.context.models.rampScheduleTemplates.getById(
        body.templateId,
      );
      if (!tmpl) {
        throw new Error(`Template '${body.templateId}' not found`);
      }
      template = tmpl;
    }

    const startDate = body.startDate ? new Date(body.startDate) : undefined;

    const resolvedSteps: RampScheduleInterface["steps"] = (() => {
      if (body.steps !== undefined) {
        return body.steps.map(
          (s: {
            trigger: ApiRampTrigger;
            actions?: PostBodyAction[];
            approvalNotes?: string | null;
          }) => ({
            trigger: normalizeApiTrigger(s.trigger),
            actions: (s.actions ?? []).map((a: PostBodyAction) =>
              hasTarget
                ? injectTarget(a, targetId!, body.ruleId!)
                : normalizeAction(a),
            ),
            approvalNotes: s.approvalNotes ?? undefined,
          }),
        );
      }
      if (template && hasTarget) {
        return template.steps.map((s) => ({
          trigger: s.trigger,
          actions: remapTemplateActions(
            s.actions,
            targetId!,
            body.ruleId!,
            feature!.valueType,
          ),
          approvalNotes: s.approvalNotes ?? undefined,
        }));
      }
      return [];
    })();

    const resolvedEndActions: RampStepAction[] | undefined = (() => {
      if (body.endActions !== undefined) {
        return body.endActions.map((a: PostBodyAction) =>
          hasTarget
            ? injectTarget(a, targetId!, body.ruleId!)
            : normalizeAction(a),
        );
      }
      if (
        template?.endPatch &&
        hasTarget &&
        Object.keys(template.endPatch).length > 0
      ) {
        return [
          {
            targetType: "feature-rule" as const,
            targetId: targetId!,
            patch: { ruleId: body.ruleId!, ...template.endPatch },
          },
        ];
      }
      return undefined;
    })();

    const rawEndTrigger = body.endCondition?.trigger;
    const endTrigger = rawEndTrigger
      ? {
          type: "scheduled" as const,
          at: new Date(
            (rawEndTrigger as { type: string; at: string | Date }).at,
          ),
        }
      : undefined;
    const endCondition = endTrigger ? { trigger: endTrigger } : undefined;

    const schedule = await this.create({
      name: body.name,
      entityType: "feature",
      entityId: body.featureId ?? "",
      targets: hasTarget
        ? [
            {
              id: targetId!,
              entityType: "feature",
              entityId: body.featureId!,
              ruleId: body.ruleId,
              environment: body.environment,
              status: "active",
            },
          ]
        : [],
      steps: resolvedSteps,
      endActions: resolvedEndActions,
      startDate,
      endCondition,
      status: hasTarget ? "ready" : "pending",
      currentStepIndex: -1,
      nextStepAt: null,
      nextProcessAt: startDate ?? null,
    } as Omit<
      RampScheduleInterface,
      "id" | "organization" | "dateCreated" | "dateUpdated"
    >);

    await dispatchRampEvent(this.context, schedule, "rampSchedule.created", {
      object: {
        rampScheduleId: schedule.id,
        rampName: schedule.name,
        orgId: this.context.org.id,
        entityType: schedule.entityType,
        entityId: schedule.entityId,
      },
    });

    return this.toApiInterface(schedule);
  }

  public override async handleApiUpdate(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiUpdate"]>[0],
  ) {
    const schedule = await this.getById(req.params.id);
    if (!schedule) {
      throw new Error("Ramp schedule not found");
    }

    if (!this.context.hasPremiumFeature("ramp-schedules")) {
      this.context.throwPlanDoesNotAllowError(
        "Ramp schedules require an Enterprise plan.",
      );
    }

    if (!["pending", "ready", "paused"].includes(schedule.status)) {
      throw new Error(
        `Cannot update ramp schedule in status "${schedule.status}". Only pending, ready, or paused schedules can be modified.`,
      );
    }

    const updates: Record<string, unknown> = {};
    const body = req.body;

    const resolveTargetId = (action: {
      targetType?: "feature-rule";
      targetId?: string;
      patch: unknown;
    }): RampStepAction => {
      const tid = action.targetId;
      if (tid && tid !== "t1") {
        if (!schedule.targets.some((t) => t.id === tid)) {
          throw new Error(
            `targetId '${tid}' does not exist on this ramp schedule. Use the id from schedule.targets[].id.`,
          );
        }
        return action as RampStepAction;
      }
      const activeTargets = schedule.targets.filter(
        (t) => t.status === "active",
      );
      if (activeTargets.length === 0) {
        throw new Error("Ramp schedule has no active targets.");
      }
      if (activeTargets.length > 1) {
        throw new Error(
          `Ramp schedule has ${activeTargets.length} active targets. Specify targetId explicitly in each action.`,
        );
      }
      return { ...action, targetId: activeTargets[0].id } as RampStepAction;
    };

    if (body.name !== undefined) updates.name = body.name;
    if (body.steps !== undefined) {
      updates.steps = body.steps.map(
        (step: {
          trigger: unknown;
          actions?: {
            targetType?: "feature-rule";
            targetId?: string;
            patch: unknown;
          }[];
          approvalNotes?: string | null;
        }) => ({
          ...step,
          actions: (step.actions ?? []).map(resolveTargetId),
        }),
      );
    }
    if (body.endActions !== undefined) {
      updates.endActions = body.endActions.map(resolveTargetId);
    }
    if ("startDate" in body) {
      updates.startDate = body.startDate ? new Date(body.startDate) : null;
    }
    if (body.endCondition !== undefined) {
      const ec = body.endCondition;
      if (!ec) {
        updates.endCondition = null;
      } else {
        const rawTrigger = ec.trigger;
        const trigger = rawTrigger
          ? { type: "scheduled" as const, at: new Date(rawTrigger.at) }
          : undefined;
        updates.endCondition = { trigger };
      }
    }

    updates.nextProcessAt = computeNextProcessAt({
      status: schedule.status,
      nextStepAt: schedule.nextStepAt,
      endCondition: ("endCondition" in updates
        ? updates.endCondition
        : schedule.endCondition) as RampScheduleInterface["endCondition"],
      startDate: ("startDate" in updates
        ? updates.startDate
        : schedule.startDate) as RampScheduleInterface["startDate"],
    });

    const updated = await this.updateById(schedule.id, updates);

    return this.toApiInterface(updated);
  }

  public override async handleApiDelete(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiDelete"]>[0],
  ) {
    const schedule = await this.getById(req.params.id);
    if (!schedule) {
      throw new Error("Ramp schedule not found");
    }

    if (["running", "pending-approval"].includes(schedule.status)) {
      throw new Error(
        `Cannot delete a ramp schedule in status "${schedule.status}". Pause or complete the schedule first.`,
      );
    }

    await this.deleteById(schedule.id);

    await dispatchRampEvent(this.context, schedule, "rampSchedule.deleted", {
      object: {
        rampScheduleId: schedule.id,
        rampName: schedule.name,
        orgId: this.context.org.id,
      },
    });

    return schedule.id;
  }

  // --- Custom query methods ---

  public async getAllByEntityId(
    entityType: string,
    entityId: string,
  ): Promise<RampScheduleInterface[]> {
    return this._find({ entityType, entityId });
  }

  public async getAllByFeatureId(
    featureId: string,
  ): Promise<RampScheduleInterface[]> {
    return this._find({ entityType: "feature", entityId: featureId });
  }

  // Active (non-terminal) schedules controlling the given rule. Environment
  // is optional: when omitted, any env matches; when provided, targets scoped
  // to that env OR to a wildcard (null/empty env) both match, since a wildcard
  // target applies to every environment.
  public async findByTargetRule(
    ruleId: string,
    environment?: string | null,
  ): Promise<RampScheduleInterface[]> {
    const targetMatch: Record<string, unknown> = { ruleId };
    if (environment) {
      targetMatch.environment = { $in: [environment, null, ""] };
    }
    return this._find({
      status: { $nin: ["completed", "rolled-back"] },
      targets: { $elemMatch: targetMatch },
    });
  }

  public async getActiveSchedules(): Promise<RampScheduleInterface[]> {
    return this._find({
      status: { $in: ["running", "pending", "pending-approval"] },
    });
  }

  public async findByActivatingRevision(
    featureId: string,
    version: number,
  ): Promise<RampScheduleInterface[]> {
    return this._find({
      status: "pending",
      targets: {
        $elemMatch: {
          entityType: "feature",
          entityId: featureId,
          activatingRevisionVersion: version,
        },
      },
    });
  }
}

/**
 * Cross-org query for the poller: returns minimal docs for every schedule
 * that is due for processing or pending crash-recovery.
 * Bypasses org-scoped BaseModel intentionally — the caller must load the
 * full document via a proper context after queuing the work.
 */
export async function findSchedulesDueForProcessing(
  now: Date,
): Promise<{ id: string; organization: string }[]> {
  const docs = await getCollection(COLLECTION_NAME)
    .find(
      {
        $or: [
          // Primary path: any schedule with a due process time
          { nextProcessAt: { $ne: null, $lte: now } },
          // Crash recovery: pending schedules whose activation hook may have missed
          {
            status: "pending",
            "targets.activatingRevisionVersion": { $exists: true, $ne: null },
          },
        ],
      },
      { projection: { _id: 1, id: 1, organization: 1 } },
    )
    .toArray();

  return docs.map((d) => ({
    id: (d.id as string | undefined) || String(d._id),
    organization: d.organization as string,
  }));
}
