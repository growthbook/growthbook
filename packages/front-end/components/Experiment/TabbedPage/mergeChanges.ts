import type { ExperimentChangesBody } from "shared/validators";

// Experiment fields merge, lists concatenate, and an acknowledgment of
// all-environment rules covers the save; the caller adds `dryRun` and `release`.
export function mergeChanges(
  parts: ExperimentChangesBody[],
): ExperimentChangesBody {
  const body: ExperimentChangesBody = {};
  const lists: Record<string, unknown> = body;
  for (const part of parts) {
    if (part.experiment) {
      body.experiment = {
        changes: { ...body.experiment?.changes, ...part.experiment.changes },
        base: { ...body.experiment?.base, ...part.experiment.base },
      };
    }
    if (part.allowUnscopedRules) body.allowUnscopedRules = true;
    for (const [key, value] of Object.entries(part)) {
      if (!Array.isArray(value)) continue;
      const prev = lists[key];
      lists[key] = [...(Array.isArray(prev) ? prev : []), ...value];
    }
  }
  return body;
}
