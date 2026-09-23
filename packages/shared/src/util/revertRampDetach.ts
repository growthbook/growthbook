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

// Dashboard copy names the rules only; REST callers also get the schedules,
// since they have no page showing them. A schedule left with no targets is
// deleted, so the copy says "delete" when that is every affected schedule.
export function revertRampStopWarning(
  detaches: RevisionRampDetachAction[],
  schedules: Pick<RampScheduleInterface, "id" | "name" | "targets">[],
  {
    apiRequest = false,
    draft = false,
  }: { apiRequest?: boolean; draft?: boolean } = {},
): string | null {
  if (!detaches.length) return null;
  const subject = draft
    ? "When published, this revert draft will"
    : "This revert will";
  const quote = (ids: string[]) => ids.map((id) => `"${id}"`).join(", ");
  const ruleIds = [...new Set(detaches.map((d) => d.ruleId))];
  const affected = schedules.filter((s) =>
    detaches.some((d) => d.rampScheduleId === s.id),
  );
  const deletesAll = affected.every((s) =>
    s.targets.every((t) => !!t.ruleId && ruleIds.includes(t.ruleId)),
  );
  const plural = affected.length > 1;
  const rules = `${ruleIds.length === 1 ? "Rule" : "Rules"} ${quote(ruleIds)}`;
  const ramps = apiRequest
    ? `the ramp ${plural ? "schedules" : "schedule"} ${affected
        .map((s) => `"${s.name}" (${s.id})`)
        .join(", ")}`
    : plural
      ? "their ramp-ups"
      : "its ramp-up";
  if (deletesAll) {
    const target = apiRequest ? ramps : plural ? "the ramp-ups" : "the ramp-up";
    return `${subject} delete ${target} on ${rules}.`;
  }
  return `${subject} remove ${rules} from ${ramps}.`;
}
