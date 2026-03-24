import { z } from "zod";
import { rampTarget, rampStep, RampScheduleInterface } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";

const startTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("immediately") }),
  z.object({ type: z.literal("manual") }),
  z.object({ type: z.literal("scheduled"), at: z.string().datetime() }),
]);

const endScheduleSchema = z.object({
  trigger: z.object({
    type: z.literal("scheduled"),
    at: z.string().datetime(),
  }),
  actions: z.array(
    z.object({
      targetId: z.string(),
      patch: z.object({
        ruleId: z.string(),
        coverage: z.number().min(0).max(1).optional(),
        condition: z.string().optional(),
        force: z.unknown().optional(),
      }),
    }),
  ),
});

const postRampScheduleValidator = {
  bodySchema: z.object({
    name: z.string(),
    entityType: z.enum(["feature"]),
    entityId: z.string(),
    targets: z.array(rampTarget).min(1),
    steps: z.array(rampStep).min(1),
    autoRollback: z
      .object({ enabled: z.boolean(), criteriaId: z.string() })
      .optional(),
    startTrigger: startTriggerSchema.optional(),
    endSchedule: endScheduleSchema.optional(),
  }),
};

export const postRampSchedule = createApiRequestHandler(
  postRampScheduleValidator,
)(async (req) => {
  const body = req.body;

  const schedule = await req.context.models.rampSchedules.create({
    name: body.name,
    entityType: body.entityType,
    entityId: body.entityId,
    targets: body.targets,
    steps: body.steps,
    autoRollback: body.autoRollback,
    startTrigger: body.startTrigger
      ? body.startTrigger.type === "scheduled"
        ? { type: "scheduled", at: new Date(body.startTrigger.at) }
        : body.startTrigger
      : { type: "immediately" },
    endSchedule: body.endSchedule
      ? {
          trigger: {
            type: "scheduled",
            at: new Date(body.endSchedule.trigger.at),
          },
          actions: body.endSchedule.actions,
        }
      : undefined,
    // Standalone ramps have no activating revision — they're immediately eligible to start.
    status: "ready",
    currentStepIndex: -1,
    nextStepAt: null,
    stepHistory: [],
  } as Omit<
    RampScheduleInterface,
    "id" | "organization" | "dateCreated" | "dateUpdated"
  >);

  return { rampSchedule: schedule };
});
