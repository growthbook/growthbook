import type {
  FeatureRevisionInterface,
  RevisionRampDetachAction,
} from "../validators/features";
import {
  isTerminalRampScheduleStatus,
  type RampScheduleInterface,
} from "../validators/ramp-schedule";

type RampAttachment = NonNullable<
  FeatureRevisionInterface["rampAttachments"]
>[number];

export function toRampAttachments(
  featureId: string,
  schedules: Pick<RampScheduleInterface, "id" | "status" | "targets">[],
): RampAttachment[] {
  return schedules
    .filter((s) => !isTerminalRampScheduleStatus(s.status))
    .flatMap((s) =>
      s.targets
        .filter((t) => t.entityType === "feature" && t.entityId === featureId)
        .flatMap((t) =>
          t.ruleId ? [{ rampScheduleId: s.id, ruleId: t.ruleId }] : [],
        ),
    );
}

// The detach actions a revert to `targetRevision` implies: every live ramp
// target the target revision did not have. Revisions published before
// attachments were recorded fall back to comparing the schedule's creation
// with the revision's publish.
export function getRevertRampDetachActions(
  featureId: string,
  targetRevision: Pick<
    FeatureRevisionInterface,
    "rampAttachments" | "datePublished"
  >,
  schedules: Pick<
    RampScheduleInterface,
    "id" | "status" | "targets" | "dateCreated"
  >[],
): RevisionRampDetachAction[] {
  const recorded = targetRevision.rampAttachments;
  const wasAttached = (
    schedule: (typeof schedules)[number],
    ruleId: string,
  ): boolean => {
    if (recorded) {
      // Exact: both sides are the same target's stored ruleId, and migrated
      // siblings (fr_1__dev, fr_1__prod) are distinct targets.
      return recorded.some(
        (a) => a.rampScheduleId === schedule.id && a.ruleId === ruleId,
      );
    }
    // Parsed: the dashboard holds these as JSON strings.
    const publishedAt = targetRevision.datePublished;
    return (
      !publishedAt ||
      new Date(schedule.dateCreated).getTime() <=
        new Date(publishedAt).getTime()
    );
  };

  return schedules.flatMap((schedule) =>
    toRampAttachments(featureId, [schedule])
      .filter((a) => !wasAttached(schedule, a.ruleId))
      .map((a) => ({
        mode: "detach" as const,
        rampScheduleId: a.rampScheduleId,
        ruleId: a.ruleId,
        deleteScheduleWhenEmpty: true,
      })),
  );
}

export function revertRampStopWarning(
  detaches: RevisionRampDetachAction[],
  schedules: Pick<RampScheduleInterface, "id" | "name">[],
): string | null {
  const ids = new Set(detaches.map((d) => d.rampScheduleId));
  if (!ids.size) return null;
  const names = schedules.filter((s) => ids.has(s.id)).map((s) => s.name);
  const quoted = names.map((n) => `"${n}"`).join(", ");
  return names.length === 1
    ? `Reverting to this revision stops the ramp schedule ${quoted}, which was added after it was published. The ramp is detached from this Feature Flag's rules without rolling back.`
    : `Reverting to this revision stops the ramp schedules ${quoted}, which were added after it was published. The ramps are detached from this Feature Flag's rules without rolling back.`;
}
