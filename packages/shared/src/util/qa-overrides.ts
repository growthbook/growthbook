import { LinkedFeatureInfo } from "shared/types/experiment";
import {
  QaOverrideFilters,
  QaOverrideWaitingFeature,
} from "shared/types/experiment-qa-override";

// Exposures from QA overrides are tracked under `<trackingKey>::qa` so they
// never mix with the experiment's real results. Generated tracking keys only
// contain [a-z0-9_-], so the suffix can't occur by accident, and it's plain
// text inside a SQL string literal.
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

// Linked features that won't serve an override in its environment yet: the
// experiment rule isn't in the live revision, or the flag / rule is off there.
export function getQaOverrideWaitingFeatures(
  override: { environment: string },
  linkedFeatures: Pick<
    LinkedFeatureInfo,
    "feature" | "state" | "environmentStates"
  >[],
): QaOverrideWaitingFeature[] {
  return linkedFeatures.flatMap((f): QaOverrideWaitingFeature[] => {
    if (f.state !== "live") {
      return [{ featureId: f.feature.id, reason: f.state }];
    }
    const envState = f.environmentStates[override.environment];
    if (envState && envState !== "active") {
      return [{ featureId: f.feature.id, reason: envState }];
    }
    return [];
  });
}

export type QaOverrideWaitingReason = QaOverrideWaitingFeature["reason"];

// One message per reason: what's wrong, then what to do about it. Flag and
// environment names are wrapped in backticks so the UI can show them as code.
export type QaOverrideWaitingMessage = {
  reason: QaOverrideWaitingReason;
  featureIds: string[];
  state: string;
  action: string;
};

const code = (s: string) => `\`${s}\``;

function waitingMessageText(
  reason: QaOverrideWaitingReason,
  featureIds: string[],
  environment: string,
): { state: string; action: string } {
  const plural = featureIds.length > 1;
  const flags = featureIds.map(code).join(", ");
  const env = code(environment);
  const linked = `linked Feature ${plural ? "Flags" : "Flag"} ${flags}`;
  switch (reason) {
    case "disabled-env":
      return {
        state: `The ${env} environment is off for ${linked}.`,
        action: `Turn ${env} on in ${plural ? "those flags" : "that flag"} to QA in this environment.`,
      };
    case "disabled-rule":
      return {
        state: `This experiment's rule is off in ${env} for ${linked}.`,
        action: `Turn the rule on in ${env} to QA in this environment.`,
      };
    case "draft":
      return {
        state: `This experiment's rule is still in a draft for ${linked}.`,
        action: `Publish ${plural ? "the drafts" : "the draft"} to QA it.`,
      };
    case "missing":
      return {
        state: `The live ${plural ? "revisions" : "revision"} of ${linked} ${plural ? "don't" : "doesn't"} include this experiment's rule.`,
        action: "Add the rule and publish to QA it.",
      };
    case "discarded":
      return {
        state: `The ${plural ? "drafts" : "draft"} linking Feature ${plural ? "Flags" : "Flag"} ${flags} to this experiment ${plural ? "were" : "was"} discarded.`,
        action: `Link ${plural ? "the flags" : "the flag"} again to QA it.`,
      };
    case "archived":
      return {
        state: `Linked Feature ${plural ? "Flags" : "Flag"} ${flags} ${plural ? "are" : "is"} archived.`,
        action: `Unarchive ${plural ? "them" : "it"} to QA.`,
      };
  }
}

/**
 * Why an override isn't applying yet and how to fix it, with flags that share
 * a reason grouped into one plural message, in first-seen order.
 */
export function getQaOverrideWaitingMessages(
  waitingOn: QaOverrideWaitingFeature[],
  environment: string,
): QaOverrideWaitingMessage[] {
  const byReason = new Map<QaOverrideWaitingReason, string[]>();
  for (const { featureId, reason } of waitingOn) {
    const ids = byReason.get(reason) ?? [];
    if (!ids.includes(featureId)) ids.push(featureId);
    byReason.set(reason, ids);
  }
  return [...byReason].map(([reason, featureIds]) => ({
    reason,
    featureIds,
    ...waitingMessageText(reason, featureIds, environment),
  }));
}
