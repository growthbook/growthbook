import { EventWebHookInterface } from "shared/types/event-webhook";
import {
  slackDigestNextRunAts,
  slackDigestScheduleChanges,
} from "shared/validators";

type DigestSettings = Pick<EventWebHookInterface, "enabled" | "slackOptions">;

export function getSlackDigestScheduleUpdate(
  existing: DigestSettings,
  updates: Partial<DigestSettings>,
  now: Date,
) {
  const enabled = updates.enabled ?? existing.enabled;
  const options = updates.slackOptions ?? existing.slackOptions;
  const changes = !enabled
    ? { experiment: null, feature: null }
    : !existing.enabled
      ? slackDigestNextRunAts(options, now)
      : updates.slackOptions !== undefined
        ? slackDigestScheduleChanges(
            existing.slackOptions,
            updates.slackOptions,
            now,
          )
        : {};
  const set: Record<string, Date> = {};
  const unset: Record<string, ""> = {};
  for (const kind of ["experiment", "feature"] as const) {
    const date = changes[kind];
    if (date === undefined) continue;
    const field =
      kind === "experiment" ? "nextExperimentDigestAt" : "nextFeatureDigestAt";
    if (date) set[field] = date;
    else unset[field] = "";
  }
  // Settings revisions invalidate pre-send checks, but an already accepted
  // Slack request must retain its lease until it records completion.
  return { set, unset };
}

export async function finishSlackDigestWindow({
  advance,
  release,
}: {
  advance: () => Promise<boolean>;
  release: () => Promise<unknown>;
}): Promise<void> {
  // A settings change may have replaced the due date while Slack was sending.
  // Release the old lease without replacing that new schedule.
  if (!(await advance())) await release();
}
