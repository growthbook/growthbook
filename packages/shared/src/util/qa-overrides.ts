import { LinkedFeatureInfo } from "shared/types/experiment";
import {
  QaOverrideFilters,
  QaOverrideWaitingFeature,
} from "shared/types/experiment-qa-override";

// QA exposures are tracked under `<trackingKey>::qa` so they never mix with
// the experiment's real results.
export const QA_TRACKING_KEY_SUFFIX = "::qa";

export function getQaTrackingKey(trackingKey: string): string {
  return `${trackingKey}${QA_TRACKING_KEY_SUFFIX}`;
}

export function isQaTrackingKey(trackingKey: string | undefined): boolean {
  return !!trackingKey && trackingKey.endsWith(QA_TRACKING_KEY_SUFFIX);
}

export const QA_OVERRIDE_EXPERIMENT_TYPES = ["standard", "multi-armed-bandit"];

export function experimentSupportsQaOverrides(experiment: {
  type?: string;
}): boolean {
  return QA_OVERRIDE_EXPERIMENT_TYPES.includes(experiment.type ?? "standard");
}

export function qaOverrideHasCondition(filters: QaOverrideFilters): boolean {
  return !!filters.condition && filters.condition !== "{}";
}

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

export function getQaOverrideWaitingFeatures(
  override: { environment: string },
  linkedFeatures: Pick<
    LinkedFeatureInfo,
    "feature" | "state" | "environmentStates" | "draftRevisionVersion"
  >[],
): QaOverrideWaitingFeature[] {
  return linkedFeatures.flatMap((f): QaOverrideWaitingFeature[] => {
    if (f.state !== "live") {
      return [
        {
          featureId: f.feature.id,
          reason: f.state,
          ...(f.state === "draft" && f.draftRevisionVersion !== undefined
            ? { draftVersion: f.draftRevisionVersion }
            : {}),
        },
      ];
    }
    const envState = f.environmentStates[override.environment];
    if (envState && envState !== "active") {
      return [{ featureId: f.feature.id, reason: envState }];
    }
    return [];
  });
}
