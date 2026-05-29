import escapeRegExp from "lodash/escapeRegExp";
import mongoose from "mongoose";
import { UpdateProps } from "shared/types/base-model";
import {
  ApiRampScheduleInterface,
  RampScheduleInterface,
  RampStepAction,
  StepHoldConditions,
  rampScheduleValidator,
} from "shared/validators";
import { RULE_ID_ENV_SUFFIX_DELIMITER, stemRuleId } from "shared/util";
import { rampScheduleApiSpec } from "back-end/src/api/specs/ramp-schedule.spec";
import {
  appendRampEvent,
  assertCanUpdateLinkedSafeRolloutMonitoringConfig,
  computeNextProcessAt,
  dispatchRampEvent,
  getEffectiveRampAutoUpdateState,
  getRampAutoUpdatePreference,
  getRampMonitoringMode,
  syncLinkedSafeRolloutForRampState,
} from "back-end/src/services/rampSchedule";
import { applyPagination } from "back-end/src/util/handler";
import { rampTargetsEquivalent } from "back-end/src/util/flattenRules";
import { MakeModelClass } from "./BaseModel";

export const COLLECTION_NAME = "rampschedules";

export function migrateRampScheduleEndCondition<
  T extends {
    endCondition?: { trigger?: { type: string; at: unknown } | null } | null;
    cutoffDate?: Date | string | null;
  },
>(doc: T): T {
  if (doc.cutoffDate) {
    return doc.endCondition ? { ...doc, endCondition: null } : doc;
  }
  const trigger = doc.endCondition?.trigger;
  if (trigger?.type === "scheduled" && trigger.at) {
    return {
      ...doc,
      cutoffDate:
        trigger.at instanceof Date ? trigger.at : (trigger.at as string),
      endCondition: null,
    };
  }
  return doc;
}

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
  additionalIndexes: [
    // Agenda poller queries by nextProcessAt on every tick — must be indexed.
    // Intentionally omits the organization prefix because
    // dangerouslyFindAllDueSchedules is a cross-tenant query.
    // sparse: true matches the existing index (most documents have nextProcessAt: null).
    { fields: { nextProcessAt: 1 }, sparse: true },
  ],
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

function dateToIso(d: Date | null | undefined): string | null | undefined {
  if (d === null) return null;
  if (d === undefined) return undefined;
  return d.toISOString();
}

// Legacy step shape (pre-`interval` redesign). Kept here purely so JIT
// migration can recognize it on read.
type LegacyTriggerStep = {
  trigger?:
    | { type: "interval"; seconds: number }
    | { type: "approval" }
    | { type: "scheduled"; at: Date | string }
    | null;
  interval?: number | null;
  holdConditions?: StepHoldConditions;
};

// Normalizes legacy `trigger` discriminated union to the unified `interval` +
// `holdConditions.requiresApproval` shape. Idempotent on already-migrated docs.
export function migrateRampStepTriggers<
  T extends { steps?: LegacyTriggerStep[] | null },
>(doc: T): T {
  if (!doc.steps || !Array.isArray(doc.steps)) return doc;
  let changed = false;
  const steps = doc.steps.map((s) => {
    if (!s || !s.trigger) return s;
    changed = true;
    const { trigger, ...rest } = s;
    if (trigger.type === "interval") {
      return { ...rest, interval: trigger.seconds };
    }
    if (trigger.type === "approval") {
      return {
        ...rest,
        interval: null,
        holdConditions: {
          ...(rest.holdConditions ?? {}),
          requiresApproval: true,
        },
      };
    }
    // "scheduled" steps were only emitted by buildScheduleRampAction as a
    // synthetic step-0; their `at` is already represented at the ramp level
    // via startDate. Strip the trigger and let the schedule's startDate drive.
    return { ...rest, interval: null };
  });
  return changed ? { ...doc, steps } : doc;
}

// `pending-approval` is no longer a stored status. The evaluator derives
// "awaiting approval" from `running` + current step's
// `holdConditions.requiresApproval` + `stepApproval?.stepIndex !== currentStepIndex`.
export function migrateRampScheduleStatus<T extends { status?: string }>(
  doc: T,
): T {
  if (doc.status === "pending-approval") {
    return { ...doc, status: "running" };
  }
  return doc;
}

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
    startActions: doc.startActions,
    steps: doc.steps.map((s) => ({
      interval: s.interval,
      actions: s.actions,
      approvalNotes: s.approvalNotes ?? undefined,
      monitored: !!s.monitored,
      holdConditions: s.holdConditions ?? undefined,
    })),
    endActions: doc.endActions,
    startDate: dateToIso(doc.startDate),
    cutoffDate: dateToIso(doc.cutoffDate),
    status: doc.status,
    currentStepIndex: doc.currentStepIndex,
    startedAt: dateToIso(doc.startedAt),
    phaseStartedAt: dateToIso(doc.phaseStartedAt),
    pausedAt: dateToIso(doc.pausedAt),
    nextStepAt: dateToIso(doc.nextStepAt) ?? null,
    nextProcessAt: dateToIso(doc.nextProcessAt),
    elapsedMs: doc.elapsedMs,
    lockdownConfig: doc.lockdownConfig,
    monitoringConfig: doc.monitoringConfig
      ? {
          ...doc.monitoringConfig,
          signalMetricIds: doc.monitoringConfig.signalMetricIds ?? [],
        }
      : doc.monitoringConfig,
    experimentHealthAction: doc.experimentHealthAction,
    currentStepEnteredAt: dateToIso(doc.currentStepEnteredAt),
    monitoringStartDate: dateToIso(doc.monitoringStartDate),
    lastRollbackAt: dateToIso(doc.lastRollbackAt),
    lastRollbackReason: doc.lastRollbackReason,
    monitoringStatus: doc.monitoringConfig
      ? (() => {
          const autoUpdateState = getEffectiveRampAutoUpdateState(doc);
          const monitoringMode = getRampMonitoringMode(doc.monitoringConfig);
          return {
            safeRolloutId: doc.safeRolloutId ?? null,
            monitoringMode,
            autoUpdate: getRampAutoUpdatePreference(doc.monitoringConfig),
            effectiveAutoUpdate: autoUpdateState.enabled,
            blockedReason: autoUpdateState.reason,
            nextSnapshotAt: dateToIso(doc.nextSnapshotAt),
            currentStepMonitored:
              doc.currentStepIndex >= 0 &&
              !!doc.steps[doc.currentStepIndex]?.monitored,
          };
        })()
      : undefined,
  };
}

// Legacy API trigger shape, accepted on input for backward compatibility.
// Public responses always emit the unified `interval` + `holdConditions` shape.
type LegacyApiRampTrigger =
  | { type: "interval"; seconds: number }
  | { type: "approval" }
  | { type: "scheduled"; at: string };

type PostBodyAction = {
  targetType?: "feature-rule";
  targetId?: string;
  patch: Partial<RampStepAction["patch"]>;
};

// Normalize a legacy API trigger input into the unified `interval` +
// `holdConditions` shape used internally and on output.
function normalizeLegacyApiTrigger(
  trigger: LegacyApiRampTrigger,
  existingHoldConditions?: StepHoldConditions,
): { interval: number | null; holdConditions?: StepHoldConditions } {
  if (trigger.type === "interval") {
    return {
      interval: trigger.seconds,
      ...(existingHoldConditions
        ? { holdConditions: existingHoldConditions }
        : {}),
    };
  }
  if (trigger.type === "approval") {
    return {
      interval: null,
      holdConditions: {
        ...(existingHoldConditions ?? {}),
        requiresApproval: true,
      },
    };
  }
  // `scheduled` trigger types are no longer accepted as step-level triggers;
  // callers should set `startDate` at the schedule level instead.
  return {
    interval: null,
    ...(existingHoldConditions
      ? { holdConditions: existingHoldConditions }
      : {}),
  };
}

// Accepts both the new `{ interval, holdConditions }` shape and the legacy
// `{ trigger: { type, ... } }` shape on input. Returns the unified shape.
function normalizeApiStepShape(s: {
  interval?: number | null;
  trigger?: LegacyApiRampTrigger;
  holdConditions?: StepHoldConditions;
}): { interval: number | null; holdConditions?: StepHoldConditions } {
  if (s.trigger) {
    return normalizeLegacyApiTrigger(s.trigger, s.holdConditions);
  }
  return {
    interval: s.interval ?? null,
    ...(s.holdConditions ? { holdConditions: s.holdConditions } : {}),
  };
}

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

  protected migrate(legacyDoc: unknown): RampScheduleInterface {
    const doc = legacyDoc as RampScheduleInterface;
    const endCondMigrated = migrateRampScheduleEndCondition(doc);
    const statusMigrated = migrateRampScheduleStatus(endCondMigrated);
    const triggersMigrated = migrateRampStepTriggers(statusMigrated);
    const migrated = triggersMigrated as RampScheduleInterface;
    const result =
      migrated.cutoffDate && typeof migrated.cutoffDate === "string"
        ? { ...migrated, cutoffDate: new Date(migrated.cutoffDate) }
        : migrated;
    if (
      result.steps?.some(
        (s) => s.monitored == null || s.holdConditions === null,
      )
    ) {
      result.steps = result.steps.map((s) => ({
        ...s,
        monitored: !!s.monitored,
        ...(s.holdConditions === null ? { holdConditions: undefined } : {}),
      }));
    }

    const legacyGs = (result as Record<string, unknown>).guardrailSettings as
      | { experimentHealthAction?: string }
      | undefined;
    if (legacyGs) {
      if (!result.experimentHealthAction && legacyGs.experimentHealthAction) {
        const action = legacyGs.experimentHealthAction;
        if (action === "rollback" || action === "hold" || action === "warn") {
          result.experimentHealthAction = action;
        }
      }
      delete (result as Record<string, unknown>).guardrailSettings;
    }

    if (
      result.monitoringConfig &&
      (result.monitoringConfig as Record<string, unknown>).autoRollback != null
    ) {
      if (!result.experimentHealthAction) {
        result.experimentHealthAction = (
          result.monitoringConfig as Record<string, unknown>
        ).autoRollback
          ? ("rollback" as const)
          : ("warn" as const);
      }
      delete (result.monitoringConfig as Record<string, unknown>).autoRollback;
    }

    if (
      result.monitoringConfig &&
      result.monitoringConfig.signalMetricIds == null
    ) {
      result.monitoringConfig = {
        ...result.monitoringConfig,
        signalMetricIds: [],
      };
    }

    if (
      result.steps?.some(
        (s) => (s as Record<string, unknown>).guardrailSettings != null,
      )
    ) {
      result.steps = result.steps.map((s) => {
        const { guardrailSettings: _, ...rest } = s as typeof s & {
          guardrailSettings?: unknown;
        };
        return rest;
      });
    }

    // Migrate legacy stepApprovedAt (plain Date) → stepApproval object.
    // stepIndex defaults to currentStepIndex since the old field had no
    // step-scoping; approvedBy and context are unknown so we use sentinel
    // values. The migrated record remains valid for the current step.
    const legacy = result as Record<string, unknown>;
    if (legacy.stepApprovedAt && !result.stepApproval) {
      const approvedAt =
        legacy.stepApprovedAt instanceof Date
          ? legacy.stepApprovedAt
          : new Date(legacy.stepApprovedAt as string);
      result.stepApproval = {
        stepIndex: result.currentStepIndex ?? 0,
        approvedAt,
        approvedBy: "unknown",
        context: "ui",
      };
    }
    delete legacy.stepApprovedAt;

    return result;
  }

  protected toApiInterface(
    doc: RampScheduleInterface,
  ): ApiRampScheduleInterface {
    return rampScheduleToApiInterface(doc);
  }

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

    return {
      rampSchedules: filtered.map((s) => this.toApiInterface(s)),
      ...returnFields,
    } as unknown as ReturnType<
      InstanceType<typeof BaseClass>["handleApiList"]
    > extends Promise<infer R>
      ? R
      : never;
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
    const body = req.body as typeof req.body & {
      startActions?: PostBodyAction[];
    };

    const resolveTargetId = (action: {
      targetType?: "feature-rule";
      targetId?: string;
      patch?: unknown;
    }): RampStepAction => {
      const tid = action.targetId;
      // "t1" is a sentinel meaning "resolve to the active target at apply-time"
      // rather than a literal stored target id. Any other non-empty string is
      // treated as a real target id that must exist in schedule.targets.
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
    if (body.startActions !== undefined) {
      updates.startActions = body.startActions.map(resolveTargetId);
    }
    if (body.steps !== undefined) {
      updates.steps = body.steps.map(
        (step: {
          interval?: number | null;
          trigger?: LegacyApiRampTrigger;
          actions?: {
            targetType?: "feature-rule";
            targetId?: string;
            patch?: unknown;
          }[];
          approvalNotes?: string | null;
          monitored?: boolean | null;
          holdConditions?: StepHoldConditions | null;
        }) => {
          const normalized = normalizeApiStepShape({
            interval: step.interval,
            trigger: step.trigger,
            holdConditions: step.holdConditions ?? undefined,
          });
          return {
            interval: normalized.interval,
            actions: (step.actions ?? []).map(resolveTargetId),
            approvalNotes: step.approvalNotes ?? undefined,
            monitored: !!step.monitored,
            holdConditions: normalized.holdConditions,
          };
        },
      );
    }
    if (body.endActions !== undefined) {
      updates.endActions = body.endActions.map(resolveTargetId);
    }
    if ("startDate" in body) {
      updates.startDate = body.startDate ? new Date(body.startDate) : null;
    }
    if ("cutoffDate" in body) {
      updates.cutoffDate = body.cutoffDate
        ? new Date(body.cutoffDate as string)
        : null;
    }
    if (body.lockdownConfig !== undefined) {
      updates.lockdownConfig = body.lockdownConfig;
    }
    if (body.monitoringConfig !== undefined) {
      const monitoringConfig = body.monitoringConfig;
      updates.monitoringConfig =
        monitoringConfig && monitoringConfig.monitoringMode
          ? {
              ...monitoringConfig,
              autoUpdate: monitoringConfig.monitoringMode === "auto",
            }
          : monitoringConfig;
      await assertCanUpdateLinkedSafeRolloutMonitoringConfig(
        this.context,
        schedule,
        updates.monitoringConfig as RampScheduleInterface["monitoringConfig"],
      );
    }
    if (body.experimentHealthAction !== undefined) {
      updates.experimentHealthAction = body.experimentHealthAction;
    }

    updates.nextProcessAt = computeNextProcessAt({
      status: schedule.status,
      nextStepAt: schedule.nextStepAt,
      cutoffDate: ("cutoffDate" in updates
        ? updates.cutoffDate
        : schedule.cutoffDate) as RampScheduleInterface["cutoffDate"],
      startDate: ("startDate" in updates
        ? updates.startDate
        : schedule.startDate) as RampScheduleInterface["startDate"],
    });

    const editedFields = Object.keys(updates).filter(
      (k) => k !== "nextProcessAt" && k !== "eventHistory",
    );
    if (editedFields.length > 0) {
      updates.eventHistory = appendRampEvent(schedule, "config-edited", {
        stepIndex: schedule.currentStepIndex,
        status: schedule.status,
        reason: `Edited: ${editedFields.join(", ")}`,
      });
    }

    const updated = await this.updateById(schedule.id, updates);

    if (
      (body.monitoringConfig?.autoUpdate !== undefined ||
        body.monitoringConfig?.monitoringMode !== undefined) &&
      schedule.safeRolloutId
    ) {
      await syncLinkedSafeRolloutForRampState(this.context, updated);
    }

    return this.toApiInterface(updated);
  }

  public override async handleApiDelete(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiDelete"]>[0],
  ) {
    const schedule = await this.getById(req.params.id);
    if (!schedule) {
      throw new Error("Ramp schedule not found");
    }

    if (schedule.status === "running") {
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

  public async getAllByFeatureIds(
    featureIds: string[],
  ): Promise<RampScheduleInterface[]> {
    if (featureIds.length === 0) return [];
    return this._find({
      entityType: "feature",
      entityId: { $in: featureIds },
    });
  }

  public async findByTargetRule(
    ruleId: string,
    environment?: string | null,
  ): Promise<RampScheduleInterface[]> {
    const stem = stemRuleId(ruleId);
    // Match both bare and migration-suffixed rule IDs, then re-check env scope in memory.
    const stemRegex = new RegExp(
      `^${escapeRegExp(stem)}(?:${RULE_ID_ENV_SUFFIX_DELIMITER}|$)`,
    );
    const candidates = await this._find({
      status: { $nin: ["completed", "rolled-back"] },
      targets: { $elemMatch: { ruleId: { $regex: stemRegex } } },
    });

    const query = { ruleId, environment: environment ?? null };
    return candidates.filter((s) =>
      s.targets.some((t) => rampTargetsEquivalent(t, query)),
    );
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

  public async getPayloadRampMonitoredRuleMap(): Promise<
    Map<string, RampMonitoredRuleInfo>
  > {
    // SDK payloads need monitored rollout rules rendered as experiments.
    // Include `paused` so rules keep experiment shape when a monitored step is
    // held (guardrail, min-sample, approval gate) — users are still bucketed
    // and removing experiment shape during a hold would lose tracking continuity.
    // Also include the legacy `pending-approval` value for docs that predate
    // the derived-status model and have not yet been migrated.
    const schedules = await this._find({
      status: { $in: ["running", "paused", "pending-approval"] },
    });
    const map = new Map<string, RampMonitoredRuleInfo>();
    for (const schedule of schedules) {
      const stepIdx = schedule.currentStepIndex;
      if (stepIdx < 0 || stepIdx >= schedule.steps.length) continue;
      const step = schedule.steps[stepIdx];
      if (!step?.monitored) continue;

      for (const target of schedule.targets) {
        if (!target.ruleId || target.status !== "active") continue;
        map.set(target.ruleId, {
          featureId: target.entityId,
          rampScheduleId: schedule.id,
          safeRolloutId: schedule.safeRolloutId ?? undefined,
        });
      }
    }
    return map;
  }

  /**
   * Cross-tenant query: finds all due ramp schedules across every org in one
   * Mongo round-trip. Only called from the Agenda poller — do not use elsewhere.
   */
  public static async dangerouslyFindAllDueSchedules(
    now: Date,
  ): Promise<{ id: string; organization: string }[]> {
    const collection = mongoose.connection.db.collection(COLLECTION_NAME);
    const docs = (await collection
      .find(
        {
          $or: [
            { nextProcessAt: { $ne: null, $lte: now } },
            {
              status: "pending",
              "targets.activatingRevisionVersion": { $exists: true, $ne: null },
            },
          ],
        },
        { projection: { id: 1, organization: 1, _id: 0 } },
      )
      .toArray()) as unknown as Array<Record<string, unknown>>;
    return docs.filter(
      (d): d is { id: string; organization: string } =>
        typeof d.id === "string" && typeof d.organization === "string",
    );
  }
}

export type RampMonitoredRuleInfo = {
  featureId: string;
  rampScheduleId: string;
  safeRolloutId?: string;
};
