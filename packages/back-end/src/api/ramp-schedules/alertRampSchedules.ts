import { z } from "zod";
import {
  PermissionError,
  rampControlFootprint,
  rampRuleEnvKey,
} from "shared/util";
import { componentSchema } from "shared/validators";
import type {
  RampScheduleInterface,
  RampScheduleStatus,
} from "shared/validators";
import { getEnvironmentIdsFromOrg } from "back-end/src/services/organizations";
import {
  pauseSchedule,
  rollbackSchedule,
  runControlledRampScheduleAction,
} from "back-end/src/services/rampSchedule";
import {
  getAllFeatures,
  getFeatureRuleEnvironmentsByIds,
} from "back-end/src/models/FeatureModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { ConflictError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import {
  RampAlertFilters,
  hasRampAlertFilters,
  rampMatchesAlertFilters,
  splitCsv,
} from "back-end/src/util/rampAlertFilters";
import type { ApiReqContext } from "back-end/types/api";

// Alert titles plus links run long, and a rejected webhook is a missed alert,
// so the reason is cut rather than refused.
const MAX_REASON_LENGTH = 500;

const csvFilter = (description: string) =>
  z
    .string()
    .transform(splitCsv)
    .describe(description)
    .meta({ type: "array", items: { type: "string" }, explode: false })
    .optional();

// Strict, so a misspelled filter is refused instead of matching every ramp.
const alertQuerySchema = z
  .object({
    environment: csvFilter(
      "Comma-separated environments. Matches ramps whose rules run in any of them.",
    ),
    project: csvFilter(
      "Comma-separated Project ids. Matches ramps on Feature Flags in any of them.",
    ),
    tag: csvFilter(
      "Comma-separated tags. Matches ramps on Feature Flags with any of them.",
    ),
    feature: csvFilter("Comma-separated Feature Flag ids."),
    customFields: z
      .record(z.string(), z.string())
      .describe(
        "Custom field values, as `customFields[<key>]=<value>`. Comma-separate several values for one key.",
      )
      .meta({ style: "deepObject", explode: true })
      .optional(),
  })
  .strict();

// Alerting tools post their own payloads, so unknown fields are allowed.
const alertBodySchema = z
  .object({
    reason: z
      .string()
      .optional()
      .describe(
        "Recorded on each ramp, prefixed with `Alert: `. Use the alert title and link.",
      ),
  })
  .loose()
  .optional();

const alertResponseSchema = z.object({
  rampSchedules: z.array(
    componentSchema(
      "MatchedRampSchedule",
      z.object({
        id: z.string(),
        featureId: z.string(),
        result: z.enum(["applied", "skipped"]),
        message: z.string().optional(),
      }),
    ),
  ),
});

const rampFeatureIds = (schedule: RampScheduleInterface) => [
  schedule.entityId,
  ...schedule.targets.map((t) => t.entityId),
];

async function filterRampSchedules(
  context: ApiReqContext,
  schedules: RampScheduleInterface[],
  filters: RampAlertFilters,
): Promise<RampScheduleInterface[]> {
  if (!schedules.length) return [];

  const features = new Map(
    (
      await getAllFeatures(context, {
        ids: [...new Set(schedules.flatMap(rampFeatureIds))],
        includeArchived: true,
      })
    ).map((f) => [f.id, f]),
  );

  // Environments are what each ramp's rules serve now, as the control gate
  // measures them; only worth the lookup when filtering on them.
  const ruleEnvs = filters.environment?.length
    ? await getFeatureRuleEnvironmentsByIds(
        context,
        schedules.flatMap((s) =>
          s.targets.map((t) => ({
            featureId: t.entityId,
            ruleId: t.ruleId ?? undefined,
            environment: t.environment ?? undefined,
          })),
        ),
      )
    : null;
  const allEnvironments = getEnvironmentIdsFromOrg(context.org);

  return schedules.filter((schedule) =>
    rampMatchesAlertFilters(
      {
        features: rampFeatureIds(schedule).flatMap(
          (id) => features.get(id) ?? [],
        ),
        environments: ruleEnvs
          ? rampControlFootprint({
              schedule,
              allEnvironments,
              ruleEnvsForTarget: (t) =>
                t.ruleId
                  ? ruleEnvs.get(
                      rampRuleEnvKey(
                        t.entityId ?? schedule.entityId,
                        t.ruleId,
                        t.environment ?? undefined,
                      ),
                    )
                  : undefined,
            })
          : [],
      },
      filters,
    ),
  );
}

async function applyAlertAction(
  context: ApiReqContext,
  action: "rollback" | "pause",
  filters: RampAlertFilters,
  cause: string | undefined,
): Promise<z.infer<typeof alertResponseSchema>> {
  const trimmed = cause?.trim();
  const reason = (trimmed ? `Alert: ${trimmed}` : "Alert").slice(
    0,
    MAX_REASON_LENGTH,
  );
  const statuses: RampScheduleStatus[] =
    action === "pause" ? ["running"] : ["running", "paused"];

  const matched = await filterRampSchedules(
    context,
    await context.models.rampSchedules.getByStatuses(statuses),
    filters,
  );

  const rampSchedules: z.infer<typeof alertResponseSchema>["rampSchedules"] =
    [];
  // One at a time: two ramps on the same Feature Flag both publish to it.
  for (const schedule of matched) {
    try {
      await runControlledRampScheduleAction(context, schedule.id, (fresh) => {
        if (!statuses.includes(fresh.status)) {
          throw new ConflictError(
            `Schedule changed to "${fresh.status}" while the request was in flight`,
          );
        }
        return action === "pause"
          ? pauseSchedule(context, fresh, reason)
          : rollbackSchedule(context, fresh, reason);
      });
      rampSchedules.push({
        id: schedule.id,
        featureId: schedule.entityId,
        result: "applied",
      });
    } catch (e) {
      if (!(e instanceof PermissionError) && !(e instanceof ConflictError)) {
        logger.error(e, `Alert ${action} failed for ramp schedule`);
      }
      rampSchedules.push({
        id: schedule.id,
        featureId: schedule.entityId,
        result: "skipped",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { rampSchedules };
}

const alertEndpointSpec = {
  bodySchema: alertBodySchema,
  querySchema: alertQuerySchema,
  responseSchema: alertResponseSchema,
  method: "post" as const,
  tags: ["ramp-schedules"],
};

export const rollbackMatchingRampSchedules = createApiRequestHandler({
  ...alertEndpointSpec,
  path: "/ramp-schedules/actions/rollback",
  confirmation: ["rampSchedule.progression"] as const,
  operationId: "rollbackMatchingRampSchedules",
  summary: "Roll back matching ramp schedules",
  description:
    "Rolls back every `running` or `paused` ramp schedule that matches the query\nfilters. Built for an alerting tool's webhook, such as a Datadog monitor.\n\nEach filter takes comma-separated values and matches any of them; different\nfilters must all match. At least one filter is required.\n\nReturns each matched schedule and whether the rollback was applied or skipped,\nfor example because the API key can't publish its Feature Flag. Unknown body\nfields are ignored, so a tool can send its own payload.\n",
})(async (req) => {
  if (!hasRampAlertFilters(req.query)) {
    throw new Error(
      "Rolling back requires at least one filter: environment, project, tag, feature or customFields.",
    );
  }
  return applyAlertAction(req.context, "rollback", req.query, req.body?.reason);
});

export const pauseMatchingRampSchedules = createApiRequestHandler({
  ...alertEndpointSpec,
  path: "/ramp-schedules/actions/pause",
  confirmation: ["rampSchedule.pause"] as const,
  operationId: "pauseMatchingRampSchedules",
  summary: "Pause matching ramp schedules",
  description:
    "Pauses every `running` ramp schedule that matches the query filters. Built\nfor an alerting tool's webhook, such as a Datadog monitor. Each schedule stays\npaused until someone calls `/actions/resume` on it.\n\nEach filter takes comma-separated values and matches any of them; different\nfilters must all match. With no filters, every running schedule is paused,\nfor example during a site-wide outage.\n\nReturns each matched schedule and whether the pause was applied or skipped,\nfor example because the API key can't publish its Feature Flag. Unknown body\nfields are ignored, so a tool can send its own payload.\n",
})(async (req) =>
  applyAlertAction(req.context, "pause", req.query, req.body?.reason),
);
