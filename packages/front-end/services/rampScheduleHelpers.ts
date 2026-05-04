import {
  RampScheduleInterface,
  RampScheduleForDisplay,
} from "shared/validators";
import { FeatureRevisionInterface } from "shared/types/feature-revision";

// Builds a `ruleId → RampScheduleInterface` map for one rendering pass of a
// feature's rules. Layers (real schedules → synthetic pending schedules) are
// applied in priority order; the first hit wins.
//
// `environment` filters both real schedules (by target.environment) and
// pending create actions (by deprecated `action.environment`). Pass an empty
// string or null/undefined to render the unfiltered "all environments" view.
export function buildRuleRampScheduleMap({
  rampSchedules,
  draftRevision,
  environment,
}: {
  rampSchedules?: RampScheduleInterface[];
  draftRevision?: FeatureRevisionInterface | null;
  // When set, only schedules/actions targeting this env are included. When
  // empty/undefined, no env filter is applied (suitable for "all environments"
  // listings).
  environment?: string;
}): Map<string, RampScheduleInterface> {
  const map = new Map<string, RampScheduleInterface>();

  for (const rs of rampSchedules ?? []) {
    for (const target of rs.targets) {
      if (!target.ruleId) continue;
      if (
        environment &&
        target.environment &&
        target.environment !== environment
      ) {
        continue;
      }
      if (!map.has(target.ruleId)) {
        map.set(target.ruleId, rs);
      }
    }
  }

  // Synthetic "pending" schedules from queued draft create actions so the rule
  // card can display a "pending publish" badge before the schedule is persisted.
  if (draftRevision?.rampActions) {
    for (const action of draftRevision.rampActions) {
      if (action.mode !== "create") continue;
      if (
        environment &&
        action.environment &&
        action.environment !== environment
      ) {
        continue;
      }
      if (map.has(action.ruleId)) continue;

      const pendingRamp: RampScheduleForDisplay = {
        id: `pending-${action.ruleId}`,
        name: action.name ?? "Pending ramp schedule",
        targets: [
          {
            id: "t1",
            entityType: "feature",
            entityId: "",
            ruleId: action.ruleId,
            environment: environment ?? undefined,
            status: "active",
          },
        ],
        steps: action.steps as RampScheduleForDisplay["steps"],
        endActions: action.endActions as RampScheduleForDisplay["endActions"],
        startDate: action.startDate ? new Date(action.startDate) : undefined,
        endCondition:
          action.endCondition?.trigger?.type === "scheduled"
            ? {
                trigger: {
                  type: "scheduled",
                  at: new Date(action.endCondition.trigger.at),
                },
              }
            : undefined,
        status: "pending",
        dateCreated: new Date(),
        dateUpdated: new Date(),
      };
      map.set(action.ruleId, pendingRamp as RampScheduleInterface);
    }
  }

  return map;
}
