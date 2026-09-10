import {
  FEATURE_HEALTH_SIGNAL_SEVERITY,
  FEATURE_HEALTH_SIGNALS,
  FeatureHealthEntry,
  FeatureHealthSeverity,
  FeatureHealthSignal,
  OLD_TEMP_ROLLOUT_DAYS,
} from "shared/util";

export type TempRolloutHealthState = "temp-rollout" | "old-temp-rollout";

export type HealthDotColor = "yellow" | "amber" | "red";

export type { FeatureHealthSeverity };

export const FEATURE_HEALTH_SEVERITIES: Record<
  FeatureHealthSeverity,
  { label: string; color: HealthDotColor }
> = {
  high: { label: "High", color: "red" },
  medium: { label: "Medium", color: "amber" },
  low: { label: "Low", color: "yellow" },
};

export function getFeatureHealthSeverity(
  state: FeatureHealthSignal,
): FeatureHealthSeverity {
  return FEATURE_HEALTH_SIGNAL_SEVERITY[state];
}

const severityColor = (state: FeatureHealthSignal): HealthDotColor =>
  FEATURE_HEALTH_SEVERITIES[getFeatureHealthSeverity(state)].color;

export const TEMP_ROLLOUT_HEALTH: Record<
  TempRolloutHealthState,
  { label: string; color: HealthDotColor }
> = {
  "temp-rollout": { label: "Temp rollout", color: "yellow" },
  "old-temp-rollout": {
    label: `Temp rollout (${OLD_TEMP_ROLLOUT_DAYS}d+)`,
    color: "yellow",
  },
};

export function isTempRolloutHealthState(
  state: string | null | undefined,
): state is TempRolloutHealthState {
  return state === "temp-rollout" || state === "old-temp-rollout";
}

// Health = things to fix or clean up while the flag stays. Staleness (can the
// flag be removed?) is a separate column with its own `is:` filters.
export type FeatureHealthState = FeatureHealthSignal;

const FEATURE_HEALTH_COPY: Record<
  FeatureHealthState,
  { label: string; description: string }
> = {
  "safe-rollout-rollback-now": {
    label: "Safe rollout: roll back",
    description: "A running safe rollout's guardrails are failing.",
  },
  "invalid-value": {
    label: "Invalid value",
    description: "A value does not match the feature's type or JSON schema.",
  },
  "ramp-needs-approval": {
    label: "Ramp needs approval",
    description: "A ramp schedule is waiting for approval to advance.",
  },
  "safe-rollout-no-data": {
    label: "Safe rollout: no data",
    description: "A running safe rollout has not received data in over a day.",
  },
  "safe-rollout-unhealthy": {
    label: "Safe rollout unhealthy",
    description:
      "A running safe rollout has a traffic imbalance or multiple exposures.",
  },
  "missing-experiment": {
    label: "Missing experiment",
    description:
      "A rule references an experiment that was deleted or archived.",
  },
  "ramp-paused": {
    label: "Ramp paused",
    description: "A ramp schedule is paused.",
  },
  "unreachable-rule": {
    label: "Unreachable rule",
    description: "An earlier rule always matches, so this rule never runs.",
  },
  "old-temp-rollout": {
    label: TEMP_ROLLOUT_HEALTH["old-temp-rollout"].label,
    description: `A stopped experiment's rollout has been served for ${OLD_TEMP_ROLLOUT_DAYS}+ days. Clean up the rule.`,
  },
  "temp-rollout": {
    label: TEMP_ROLLOUT_HEALTH["temp-rollout"].label,
    description:
      "A stopped experiment's rollout is still being served. Clean up the rule.",
  },
};

export const FEATURE_HEALTH_STATES = Object.fromEntries(
  FEATURE_HEALTH_SIGNALS.map((state) => [
    state,
    { ...FEATURE_HEALTH_COPY[state], color: severityColor(state) },
  ]),
) as Record<
  FeatureHealthState,
  { label: string; color: HealthDotColor; description: string }
>;

export const FEATURE_HEALTH_STATE_ORDER: FeatureHealthState[] = [
  ...FEATURE_HEALTH_SIGNALS,
];

export type FeatureStaleSummary = {
  stale: boolean;
  envResults?: Record<
    string,
    { stale: boolean; reason?: string; tempRollout?: string }
  >;
  health?: FeatureHealthEntry[];
};

export function getFeatureHealthEntries(
  staleData: FeatureStaleSummary | undefined,
): FeatureHealthEntry[] {
  return staleData?.health ?? [];
}

export function getFeatureHealthStates(
  staleData: FeatureStaleSummary | undefined,
): FeatureHealthState[] {
  return getFeatureHealthEntries(staleData).map((e) => e.signal);
}

// Entries arrive most urgent first, so the first one is the feature's overall
// severity.
export function getFeatureOverallHealthSeverity(
  staleData: FeatureStaleSummary | undefined,
): FeatureHealthSeverity | null {
  const first = getFeatureHealthEntries(staleData)[0];
  return first ? getFeatureHealthSeverity(first.signal) : null;
}

// Tooltip body for one deduped entry: what it means, plus how many rules,
// ramps, or environments triggered it.
export function describeFeatureHealthEntry(entry: FeatureHealthEntry): string {
  const { description } = FEATURE_HEALTH_STATES[entry.signal];
  const parts = [description];
  if (entry.count > 1) parts.push(`${entry.count} occurrences.`);
  if (entry.environments?.length) {
    parts.push(`Environments: ${entry.environments.join(", ")}.`);
  }
  return parts.join(" ");
}

// `health:` search tokens: every signal present, its severity, and the overall
// severity is implied by the most severe. An old temp rollout is still a temp
// rollout, so `health:temp-rollout` matches both tiers.
export function getFeatureHealthSearchTokens(
  staleData: FeatureStaleSummary | undefined,
): (FeatureHealthState | FeatureHealthSeverity)[] {
  const states = getFeatureHealthStates(staleData);
  const tokens: (FeatureHealthState | FeatureHealthSeverity)[] = [...states];
  if (states.includes("old-temp-rollout") && !states.includes("temp-rollout")) {
    tokens.push("temp-rollout");
  }
  for (const severity of new Set(states.map(getFeatureHealthSeverity))) {
    tokens.push(severity);
  }
  return tokens;
}

// Whether an entry is one the user asked about via `health:` filter values
// (signals, the temp-rollout alias, or severities).
export function entryMatchesHealthFilter(
  entry: FeatureHealthEntry,
  filterValues: string[],
): boolean {
  return filterValues.some(
    (v) =>
      v === entry.signal ||
      (v === "temp-rollout" && entry.signal === "old-temp-rollout") ||
      v === getFeatureHealthSeverity(entry.signal),
  );
}

export const FEATURE_HEALTH_SEVERITY_FILTER_OPTIONS = (
  ["high", "medium", "low"] as FeatureHealthSeverity[]
).map((value) => ({ value, label: FEATURE_HEALTH_SEVERITIES[value].label }));

export const FEATURE_HEALTH_FILTER_OPTIONS = FEATURE_HEALTH_STATE_ORDER.map(
  (state) => ({ value: state, label: FEATURE_HEALTH_STATES[state].label }),
);

// Some environments stale while the feature as a whole is not.
export function isPartiallyStale(staleData: FeatureStaleSummary): boolean {
  return (
    !staleData.stale &&
    Object.values(staleData.envResults ?? {}).some((e) => e.stale)
  );
}

export type FeatureStaleSearchToken =
  | "stale"
  | "partially-stale"
  | "stale-detection-off";

export const FEATURE_STALE_FILTER_OPTIONS: {
  value: FeatureStaleSearchToken;
  label: string;
}[] = [
  { value: "stale", label: "Stale" },
  { value: "partially-stale", label: "Stale in some envs" },
  { value: "stale-detection-off", label: "Stale detection off" },
];

// `is:` search tokens for the Stale column. `neverStale` on the feature is
// authoritative over the (possibly cached) stale data.
export function getFeatureStaleSearchTokens(
  staleData: FeatureStaleSummary | undefined,
  neverStale?: boolean,
): FeatureStaleSearchToken[] {
  if (neverStale) return ["stale-detection-off"];
  if (!staleData) return [];
  if (staleData.stale) return ["stale"];
  return isPartiallyStale(staleData) ? ["partially-stale"] : [];
}
