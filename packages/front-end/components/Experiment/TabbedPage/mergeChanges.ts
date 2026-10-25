import type { ExperimentChangesBody } from "shared/validators";

/**
 * One changeset from the page's edits, each holding a share of it: experiment
 * fields merge and every list adds up. `dryRun`, `allowUnscopedRules` and
 * `release` are the caller's, not an edit's.
 */
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
    for (const [key, value] of Object.entries(part)) {
      if (!Array.isArray(value)) continue;
      const prev = lists[key];
      lists[key] = [...(Array.isArray(prev) ? prev : []), ...value];
    }
  }
  return body;
}
