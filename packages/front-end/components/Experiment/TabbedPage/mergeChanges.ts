import type { ExperimentChangesBody } from "shared/validators";

/**
 * One changeset from the page's edits, each holding a share of it. A body key
 * with no branch here is silently dropped from the save; `dryRun` is the
 * caller's, not an edit's.
 */
export function mergeChanges(
  parts: ExperimentChangesBody[],
): ExperimentChangesBody {
  const body: ExperimentChangesBody = {};
  for (const part of parts) {
    if (part.experiment) {
      body.experiment = {
        changes: { ...body.experiment?.changes, ...part.experiment.changes },
        base: { ...body.experiment?.base, ...part.experiment.base },
      };
    }
    if (part.flagValues) {
      body.flagValues = [...(body.flagValues ?? []), ...part.flagValues];
    }
    if (part.linkFeatures) {
      body.linkFeatures = [...(body.linkFeatures ?? []), ...part.linkFeatures];
    }
    if (part.unlinkFeatures) {
      body.unlinkFeatures = [
        ...(body.unlinkFeatures ?? []),
        ...part.unlinkFeatures,
      ];
    }
    if (part.keepFeatures) {
      body.keepFeatures = [...(body.keepFeatures ?? []), ...part.keepFeatures];
    }
    if (part.managedFlag) body.managedFlag = part.managedFlag;
    if (part.renameManagedFlag) {
      body.renameManagedFlag = part.renameManagedFlag;
    }
    if (part.deleteManagedFlag) body.deleteManagedFlag = true;
    if (part.addUrlRedirects) {
      body.addUrlRedirects = [
        ...(body.addUrlRedirects ?? []),
        ...part.addUrlRedirects,
      ];
    }
    if (part.editUrlRedirects) {
      body.editUrlRedirects = [
        ...(body.editUrlRedirects ?? []),
        ...part.editUrlRedirects,
      ];
    }
    if (part.removeUrlRedirects) {
      body.removeUrlRedirects = [
        ...(body.removeUrlRedirects ?? []),
        ...part.removeUrlRedirects,
      ];
    }
    if (part.editVisualChangesets) {
      body.editVisualChangesets = [
        ...(body.editVisualChangesets ?? []),
        ...part.editVisualChangesets,
      ];
    }
    if (part.removeVisualChangesets) {
      body.removeVisualChangesets = [
        ...(body.removeVisualChangesets ?? []),
        ...part.removeVisualChangesets,
      ];
    }
  }
  return body;
}
