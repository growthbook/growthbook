import { OLD_TEMP_ROLLOUT_DAYS } from "shared/util";

export type TempRolloutHealthState = "temp-rollout" | "old-temp-rollout";

export type HealthDotColor = "yellow" | "orange";

export const TEMP_ROLLOUT_HEALTH: Record<
  TempRolloutHealthState,
  { label: string; color: HealthDotColor }
> = {
  "temp-rollout": { label: "Temp rollout", color: "yellow" },
  "old-temp-rollout": {
    label: `Temp rollout (${OLD_TEMP_ROLLOUT_DAYS}d+)`,
    color: "orange",
  },
};

export function isTempRolloutHealthState(
  state: string | null | undefined,
): state is TempRolloutHealthState {
  return state === "temp-rollout" || state === "old-temp-rollout";
}

// Health = rules to clean up while the flag stays. Staleness (can the flag be
// removed?) is a separate column with its own `is:` filters.
export type FeatureHealthState = TempRolloutHealthState;

export const FEATURE_HEALTH_STATES: Record<
  FeatureHealthState,
  { label: string; color: HealthDotColor; description: string }
> = {
  "old-temp-rollout": {
    ...TEMP_ROLLOUT_HEALTH["old-temp-rollout"],
    description: `A stopped experiment's rollout has been served for ${OLD_TEMP_ROLLOUT_DAYS}+ days. Clean up the rule.`,
  },
  "temp-rollout": {
    ...TEMP_ROLLOUT_HEALTH["temp-rollout"],
    description:
      "A stopped experiment's rollout is still being served. Clean up the rule.",
  },
};

// Most urgent first. Doubles as display order when several apply.
export const FEATURE_HEALTH_STATE_ORDER = Object.keys(
  FEATURE_HEALTH_STATES,
) as FeatureHealthState[];

export type FeatureStaleSummary = {
  stale: boolean;
  envResults?: Record<
    string,
    { stale: boolean; reason?: string; tempRollout?: string }
  >;
};

export function getFeatureHealthStates(
  staleData: FeatureStaleSummary | undefined,
): FeatureHealthState[] {
  if (!staleData) return [];
  const found = new Set<FeatureHealthState>();
  for (const env of Object.values(staleData.envResults ?? {})) {
    if (isTempRolloutHealthState(env.tempRollout)) found.add(env.tempRollout);
  }
  return FEATURE_HEALTH_STATE_ORDER.filter((s) => found.has(s));
}

// `health:` search tokens. An old temp rollout is still a temp rollout, so
// `health:temp-rollout` matches both tiers.
export function getFeatureHealthSearchTokens(
  staleData: FeatureStaleSummary | undefined,
): FeatureHealthState[] {
  const tokens = getFeatureHealthStates(staleData);
  if (tokens.includes("old-temp-rollout") && !tokens.includes("temp-rollout")) {
    tokens.push("temp-rollout");
  }
  return tokens;
}

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
