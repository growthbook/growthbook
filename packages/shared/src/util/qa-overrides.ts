import type { ExperimentType } from "shared/validators";
import {
  ExperimentInterface,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import {
  ExperimentQaOverrideAssignment,
  QaOverrideFilters,
  QaOverrideInvalidReason,
  QaOverrideStaleSdkConnection,
  QaOverrideStatus,
  QaOverrideWaitingFeature,
} from "shared/types/experiment-qa-override";
import { getLatestPhaseVariations } from "../experiments/variations";

type LinkedFeatureForStatus = Pick<
  LinkedFeatureInfo,
  "feature" | "state" | "environmentStates" | "draftRevisionVersion"
>;

// QA exposures are tracked under `<trackingKey>::qa` so they never mix with
// the experiment's real results.
export const QA_TRACKING_KEY_SUFFIX = "::qa";

export function getQaTrackingKey(trackingKey: string): string {
  return `${trackingKey}${QA_TRACKING_KEY_SUFFIX}`;
}

export function isQaTrackingKey(trackingKey: string | undefined): boolean {
  return !!trackingKey && trackingKey.endsWith(QA_TRACKING_KEY_SUFFIX);
}

export const QA_OVERRIDE_EXPERIMENT_TYPES: ExperimentType[] = [
  "standard",
  "multi-armed-bandit",
];

export function experimentSupportsQaOverrides(experiment: {
  type?: ExperimentType;
}): boolean {
  return QA_OVERRIDE_EXPERIMENT_TYPES.includes(experiment.type ?? "standard");
}

export function qaOverrideHasCondition(filters: QaOverrideFilters): boolean {
  return !!filters.condition && filters.condition !== "{}";
}

// An override with attribute or Saved Group targeting of its own is served
// with that targeting in place of the experiment's.
export function qaOverrideHasOwnTargeting(filters: QaOverrideFilters): boolean {
  return (
    qaOverrideHasCondition(filters) ||
    !!filters.savedGroups?.some((g) => g.ids.length > 0)
  );
}

// A forced override whose variation has since been removed. It is kept, but
// not served.
export function qaOverrideVariationMissing(
  override: { assignment: ExperimentQaOverrideAssignment },
  experiment: Pick<ExperimentInterface, "variations" | "phases">,
): boolean {
  const { assignment } = override;
  return (
    assignment.type === "forced" &&
    !getLatestPhaseVariations(experiment).some(
      (v) => v.id === assignment.variationId,
    )
  );
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

// Order is per environment: the changes that put one environment's overrides
// in `overrideIds` order, or null unless the ids are exactly that set.
export function reorderQaOverridesInEnvironment<
  T extends { id: string; environment: string; order: number },
>(
  overrides: T[],
  environment: string,
  overrideIds: string[],
): { override: T; order: number }[] | null {
  const inEnvironment = new Map(
    overrides
      .filter((o) => o.environment === environment)
      .map((o) => [o.id, o]),
  );
  if (
    overrideIds.length !== inEnvironment.size ||
    new Set(overrideIds).size !== inEnvironment.size ||
    overrideIds.some((id) => !inEnvironment.has(id))
  ) {
    return null;
  }
  return overrideIds
    .map((id, order) => ({ override: inEnvironment.get(id) as T, order }))
    .filter(({ override, order }) => override.order !== order);
}

export function getQaOverrideWaitingFeatures(
  override: { environment: string },
  linkedFeatures: LinkedFeatureForStatus[],
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

type SdkConnectionForStatus = {
  id: string;
  environment: string;
  archived?: boolean;
};

// `connections` are the listed SDK Connections that still exist.
export function getQaOverrideStaleSdkConnections(
  override: { environment: string; filters: QaOverrideFilters },
  connections: SdkConnectionForStatus[],
): QaOverrideStaleSdkConnection[] {
  const byId = new Map(connections.map((c) => [c.id, c]));
  return (override.filters.sdkConnections ?? []).flatMap(
    (id): QaOverrideStaleSdkConnection[] => {
      const connection = byId.get(id);
      if (!connection) return [{ id, reason: "deleted" }];
      // An archived connection serves no payload in any environment.
      if (connection.archived) return [{ id, reason: "archived" }];
      if (connection.environment !== override.environment) {
        return [{ id, reason: "other-environment" }];
      }
      return [];
    },
  );
}

// Single source of truth for whether an override is being served, shared by
// the API response, the SDK payload and the UI.
export function getQaOverrideStatus(
  override: {
    environment: string;
    filters: QaOverrideFilters;
    assignment: ExperimentQaOverrideAssignment;
  },
  {
    experiment,
    linkedFeatures,
    connections,
  }: {
    experiment: Pick<ExperimentInterface, "variations" | "phases">;
    linkedFeatures: LinkedFeatureForStatus[];
    connections: SdkConnectionForStatus[];
  },
): QaOverrideStatus {
  const invalidReasons: QaOverrideInvalidReason[] = [];

  if (qaOverrideVariationMissing(override, experiment)) {
    invalidReasons.push("variation-removed");
  }

  const staleSdkConnections = getQaOverrideStaleSdkConnections(
    override,
    connections,
  );
  const listed = override.filters.sdkConnections?.length ?? 0;
  // One live connection is enough: the override still serves it.
  if (listed > 0 && staleSdkConnections.length === listed) {
    invalidReasons.push("no-matching-connection");
  }

  const waitingOn = getQaOverrideWaitingFeatures(override, linkedFeatures);

  return {
    status: invalidReasons.length
      ? "invalid"
      : waitingOn.length
        ? "waiting"
        : "active",
    waitingOn,
    invalidReasons,
    staleSdkConnections,
  };
}
