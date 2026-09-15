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

export function isBookkeepingExperimentUpdate(envelope: unknown): boolean {
  const event = record(envelope);
  if (event?.event !== "experiment.updated") return false;
  const data = record(event.data);
  if (!data) return false;
  const diff = record(data.changes);
  const added = record(diff?.added);
  const removed = record(diff?.removed);
  const modified = diff?.modified;
  const hasDiff =
    !!diff &&
    added !== null &&
    removed !== null &&
    Array.isArray(modified) &&
    Object.keys(diff).every((key) =>
      ["added", "removed", "modified"].includes(key),
    );
  const current = record(data.object);
  const previousAttributes = record(data.previous_attributes);
  if (
    current &&
    previousAttributes &&
    hasDiff &&
    typeof current.id === "string" &&
    current.id
  ) {
    // Persisted previous_attributes omits undefined values. The diff preserves
    // added keys, so remove those when reconstructing the previous snapshot.
    const previous = { ...current, ...previousAttributes, ...removed };
    for (const key of Object.keys(added)) delete previous[key];
    return isEqual(
      meaningfulExperiment(current),
      meaningfulExperiment(previous),
    );
  }
  // Missing or malformed diffs cannot establish that an update is empty.
  return (
    hasDiff &&
    Object.keys(added).length === 0 &&
    Object.keys(removed).length === 0 &&
    modified.length === 0
  );
}
