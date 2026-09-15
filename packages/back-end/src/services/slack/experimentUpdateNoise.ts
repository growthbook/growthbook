import isEqual from "lodash/isEqual";

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

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
      const fields = record(phase);
      if (!fields) return phase;
      const result = { ...fields };
      delete result.banditEvents;
      return result;
    });
  }
  return result;
}

export function isNoisyExperimentUpdate(envelope: unknown): boolean {
  const event = record(envelope);
  if (event?.event !== "experiment.updated") return false;
  const data = record(event.data);
  if (!data) return false;
  const current = record(data.object);
  const previous = record(data.previous_object);
  if (
    current &&
    previous &&
    typeof current.id === "string" &&
    current.id.length > 0 &&
    current.id === previous.id
  ) {
    return isEqual(
      meaningfulExperiment(current),
      meaningfulExperiment(previous),
    );
  }
  // Missing or malformed diffs are unknown, not evidence that nothing changed.
  const diff = record(data.changes);
  return (
    !!diff &&
    Object.keys(diff).every((key) =>
      ["added", "removed", "modified"].includes(key),
    ) &&
    record(diff.added) !== null &&
    Object.keys(diff.added as object).length === 0 &&
    record(diff.removed) !== null &&
    Object.keys(diff.removed as object).length === 0 &&
    Array.isArray(diff.modified) &&
    diff.modified.length === 0
  );
}
