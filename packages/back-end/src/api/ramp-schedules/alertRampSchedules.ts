import { z } from "zod";
import {
  PermissionError,
  rampControlFootprint,
  rampRuleEnvKey,
  rampTargetRuleIds,
} from "shared/util";
import {
  rampAlertBodyValidator,
  rampAlertQueryValidator,
  rampAlertResponseValidator,
} from "shared/validators";
import type {
  RampAlertFilters,
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
  hasRampAlertFilters,
  rampMatchesAlertFilters,
} from "back-end/src/util/rampAlertFilters";
import type { ApiReqContext } from "back-end/types/api";

// Alert titles plus links run long, and a rejected webhook is a missed alert,
// so the reason is cut rather than refused.
const MAX_REASON_LENGTH = 500;

// Every rule each target can reach: its own and any its actions' patches name,
// as `assertCanControlRampSchedule` resolves them.
const rampRuleRefs = (schedule: RampScheduleInterface) =>
  schedule.targets.flatMap((t) =>
    rampTargetRuleIds(schedule, t).map((ruleId) => ({
      featureId: t.entityId,
      ruleId,
      environment: t.environment ?? undefined,
    })),
  );

async function filterRampSchedules(
  context: ApiReqContext,
  schedules: RampScheduleInterface[],
  filters: RampAlertFilters,
): Promise<RampScheduleInterface[]> {
  if (!schedules.length) return [];

  // Targets, not the anchor `entityId`, which outlives an ejected target.
  const features = new Map(
    (
      await getAllFeatures(context, {
        ids: [
          ...new Set(
            schedules.flatMap((s) => s.targets.map((t) => t.entityId)),
          ),
        ],
        includeArchived: true,
      })
    ).map((f) => [f.id, f]),
  );

  // Environments are what each ramp's rules serve now, as the control gate
  // measures them; only worth the lookup when filtering on them.
  const ruleEnvs = filters.environment?.length
    ? await getFeatureRuleEnvironmentsByIds(
        context,
        schedules.flatMap(rampRuleRefs),
      )
    : null;
  const allEnvironments = getEnvironmentIdsFromOrg(context.org);

  return schedules.filter((schedule) =>
    rampMatchesAlertFilters(
      {
        features: schedule.targets.flatMap(
          (t) => features.get(t.entityId) ?? [],
        ),
        environments: ruleEnvs
          ? rampControlFootprint({
              schedule,
              allEnvironments,
              ruleEnvsForTarget: (t) => {
                const reachable = rampTargetRuleIds(schedule, t).map((ruleId) =>
                  ruleEnvs.get(
                    rampRuleEnvKey(
                      t.entityId ?? schedule.entityId,
                      ruleId,
                      t.environment ?? undefined,
                    ),
                  ),
                );
                if (!reachable.length) return undefined;
                return reachable.some((r) => r === "all")
                  ? "all"
                  : reachable.flatMap((r) => (Array.isArray(r) ? r : []));
              },
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
): Promise<z.infer<typeof rampAlertResponseValidator>> {
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

  const rampSchedules: z.infer<
    typeof rampAlertResponseValidator
  >["rampSchedules"] = [];
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
  bodySchema: rampAlertBodyValidator,
  querySchema: rampAlertQueryValidator,
  responseSchema: rampAlertResponseValidator,
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
  return applyAlertAction(
    req.context,
    "rollback",
    req.query,
    req.body?.reason || req.query.reason,
  );
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
  applyAlertAction(
    req.context,
    "pause",
    req.query,
    req.body?.reason || req.query.reason,
  ),
);
