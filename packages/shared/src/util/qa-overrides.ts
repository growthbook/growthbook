import { QaOverrideFilters } from "shared/types/experiment-qa-override";

export const QA_TRACKING_KEY_SUFFIX = "__qa";

export function getQaTrackingKey(trackingKey: string): string {
  return `${trackingKey}${QA_TRACKING_KEY_SUFFIX}`;
}

export function isQaTrackingKey(trackingKey: string): boolean {
  return trackingKey.endsWith(QA_TRACKING_KEY_SUFFIX);
}

export const QA_OVERRIDE_EXPERIMENT_TYPES = ["standard", "multi-armed-bandit"];

export function experimentSupportsQaOverrides(experiment: {
  type?: string;
}): boolean {
  return QA_OVERRIDE_EXPERIMENT_TYPES.includes(experiment.type ?? "standard");
}

export function qaOverrideFiltersAreEmpty(filters: QaOverrideFilters): boolean {
  return (
    !qaOverrideHasCondition(filters) &&
    !filters.savedGroups?.length &&
    !filters.sdkConnections?.length &&
    !filters.projects?.length
  );
}

export function qaOverrideHasCondition(filters: QaOverrideFilters): boolean {
  return !!filters.condition && filters.condition !== "{}";
}

// Whether a connection in the override's environment receives it. Attribute
// and saved-group filters are evaluated by the SDK, not here.
export function qaOverrideAppliesToConnection(
  override: { environment: string; filters: QaOverrideFilters },
  connection: { id: string; environment: string; projects?: string[] },
): boolean {
  if (override.environment !== connection.environment) return false;
  const { sdkConnections, projects } = override.filters;
  if (sdkConnections?.length && !sdkConnections.includes(connection.id)) {
    return false;
  }
  if (projects?.length) {
    // A connection with no projects serves every project, so it always matches.
    if (
      connection.projects?.length &&
      !connection.projects.some((p) => projects.includes(p))
    ) {
      return false;
    }
  }
  return true;
}

export function sortQaOverrides<
  T extends { order: number; dateCreated: Date | string },
>(overrides: T[]): T[] {
  return [...overrides].sort(
    (a, b) =>
      a.order - b.order ||
      new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime(),
  );
}
