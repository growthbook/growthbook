import isEqual from "lodash/isEqual";
import { z } from "zod";
import type { EventInterface } from "shared/types/events/event";

const recordSchema = z.record(z.string(), z.unknown());
const updateSchema = z.object({
  object: recordSchema.optional(),
  previous_attributes: recordSchema.optional(),
  changes: z
    .object({
      added: recordSchema.optional(),
      removed: recordSchema.optional(),
      modified: z.array(
        z
          .object({
            key: z.string().min(1),
            oldValue: z.unknown(),
            newValue: z.unknown(),
          })
          .strict(),
      ),
    })
    .strict(),
});

function meaningfulExperiment(value: Record<string, unknown>) {
  const result = { ...value };
  // Ignore refresh bookkeeping, but retain autoRefresh: disabling it matters.
  for (const key of [
    "dateUpdated",
    "lastSnapshotAttempt",
    "nextSnapshotAttempt",
  ])
    delete result[key];
  if (Array.isArray(result.phases)) {
    result.phases = result.phases.map((phase: unknown) => {
      const fields = recordSchema.safeParse(phase);
      if (!fields.success) return phase;
      const result = { ...fields.data };
      delete result.banditEvents;
      return result;
    });
  }
  return result;
}

export function isBookkeepingExperimentUpdate(event: EventInterface): boolean {
  // Legacy payloads lack the persisted diff needed to establish bookkeeping-only changes.
  if (event.version !== 1 || event.data.event !== "experiment.updated")
    return false;
  const parsed = updateSchema.safeParse(event.data.data);
  if (!parsed.success) return false;
  const {
    object: current,
    previous_attributes: previousAttributes = {},
    changes,
  } = parsed.data;
  const { added = {}, removed = {}, modified } = changes;
  if (current && typeof current.id === "string" && current.id) {
    if (
      Object.keys(added).some((key) => !(key in current)) ||
      Object.keys(removed).some((key) => key in current) ||
      modified.some(
        ({ key, oldValue, newValue }) =>
          !(key in previousAttributes) ||
          !isEqual(oldValue, previousAttributes[key]) ||
          !isEqual(newValue, current[key]),
      )
    )
      return false;
    // Persisted previous_attributes omits undefined values, so remove added keys.
    const previous = { ...current, ...previousAttributes, ...removed };
    for (const key of Object.keys(added)) delete previous[key];
    return isEqual(
      meaningfulExperiment(current),
      meaningfulExperiment(previous),
    );
  }
  return (
    Object.keys(added).length === 0 &&
    Object.keys(removed).length === 0 &&
    modified.length === 0
  );
}
