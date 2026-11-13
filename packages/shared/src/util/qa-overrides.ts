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
    "feature" | "state" | "environmentStates" | "draftRevisionVersion"
  >[],
): QaOverrideWaitingFeature[] {
  return linkedFeatures.flatMap((f): QaOverrideWaitingFeature[] => {
    if (f.state !== "live") {
      return [
        {
          featureId: f.feature.id,
          reason: f.state,
          // Lets the UI link straight to the draft that needs publishing.
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

export type QaOverrideWaitingReason = QaOverrideWaitingFeature["reason"];

// Why an override isn't applying yet, as the "Not applied" popover shows it:
// the problem as a title, one line of detail, and the one action that fixes
// it. `note` is the same thing as a single sentence, for the add/edit modal.
// Flag names are wrapped in backticks so the UI can show them as code.
export type QaOverrideWaitingMessage = {
  featureId: string;
  reason: QaOverrideWaitingReason;
  title: string;
  description: string;
  action: string;
  note: string;
  // Set when the fix is on a specific draft of the Feature Flag.
  draftVersion?: number;
};

export function getQaOverrideWaitingMessage(
  waiting: QaOverrideWaitingFeature,
  environment: string,
): QaOverrideWaitingMessage {
  const { featureId, reason } = waiting;
  const flag = `\`${featureId}\``;
  const base = { featureId, reason };
  switch (reason) {
    case "disabled-env":
      return {
        ...base,
        title: `${flag} is off in ${environment}`,
        description: `The override starts applying as soon as the flag is on in ${environment}.`,
        action: "Turn on flag",
        note: `${flag} is off in ${environment}, so this override won't apply until the flag is on.`,
      };
    case "disabled-rule":
      return {
        ...base,
        title: `The experiment rule is disabled in ${environment}`,
        description: `The rule on ${flag} is switched off for ${environment}.`,
        action: "Enable the rule",
        note: `The experiment rule on ${flag} is disabled in ${environment}, so this override won't apply until the rule is enabled.`,
      };
    case "draft":
      return {
        ...base,
        title: "The experiment rule isn't published",
        description: `It's in an unpublished draft of ${flag}.`,
        action: "Review and publish draft",
        note: `The experiment rule is in an unpublished draft of ${flag}, so this override won't apply until the draft is published.`,
        draftVersion: waiting.draftVersion,
      };
    // A discarded draft leaves the flag without the rule, the same as if it
    // had never been added.
    case "discarded":
    case "missing":
      return {
        ...base,
        title: `${flag} has no rule for this experiment`,
        description:
          "The flag isn't using this experiment, so there's nothing to override.",
        action: "Add experiment rule",
        note: `${flag} has no rule for this experiment, so this override won't apply until one is added.`,
      };
    case "archived":
      return {
        ...base,
        title: `${flag} is archived`,
        description: "Archived flags aren't sent to SDKs.",
        action: "Unarchive flag",
        note: `${flag} is archived, so this override won't apply until the flag is unarchived.`,
      };
  }
}

/** One message per Feature Flag that isn't serving the override yet. */
export function getQaOverrideWaitingMessages(
  waitingOn: QaOverrideWaitingFeature[],
  environment: string,
): QaOverrideWaitingMessage[] {
  return waitingOn.map((w) => getQaOverrideWaitingMessage(w, environment));
}
