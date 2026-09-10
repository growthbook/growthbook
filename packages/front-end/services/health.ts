import { OLD_TEMP_ROLLOUT_DAYS } from "shared/util";

export type TempRolloutHealthState = "temp-rollout" | "old-temp-rollout";

export type HealthDotColor = "yellow" | "orange" | "gray";

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

export type FeatureHealthState =
  | "stale"
  | TempRolloutHealthState
  | "detection-off";

export const FEATURE_HEALTH_STATES: Record<
  FeatureHealthState,
  { label: string; color: HealthDotColor; description: string }
> = {
  "old-temp-rollout": {
    ...TEMP_ROLLOUT_HEALTH["old-temp-rollout"],
    description: `A stopped experiment's rollout has been served for ${OLD_TEMP_ROLLOUT_DAYS}+ days. Clean up the rule.`,
  },
  stale: {
    label: "Stale",
    color: "yellow",
    description: "Every enabled environment is stale.",
  },
  "temp-rollout": {
    ...TEMP_ROLLOUT_HEALTH["temp-rollout"],
    description:
      "A stopped experiment's rollout is still being served. Clean up the rule.",
  },
  "detection-off": {
    label: "Stale detection off",
    color: "gray",
    description: "Stale detection is disabled for this feature.",
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
  neverStale?: boolean,
): FeatureHealthState[] {
  if (neverStale) return ["detection-off"];
  if (!staleData) return [];
  const found = new Set<FeatureHealthState>();
  const envs = Object.values(staleData.envResults ?? {});
  if (staleData.stale) found.add("stale");
  for (const env of envs) {
    if (isTempRolloutHealthState(env.tempRollout)) found.add(env.tempRollout);
  }
  return FEATURE_HEALTH_STATE_ORDER.filter((s) => found.has(s));
}

// Some environments stale while the feature as a whole is not. Searchable,
// but deliberately not a displayed health state: "Not stale" is the verdict
// and partial staleness is a footnote in the per-environment breakdown.
export function isPartiallyStale(staleData: FeatureStaleSummary): boolean {
  return (
    !staleData.stale &&
    Object.values(staleData.envResults ?? {}).some((e) => e.stale)
  );
}

export type FeatureHealthSearchToken = FeatureHealthState | "partially-stale";

// Filter UI order: staleness together, then temp rollouts.
export const FEATURE_HEALTH_FILTER_OPTIONS: {
  value: FeatureHealthSearchToken;
  label: string;
}[] = [
  { value: "stale", label: FEATURE_HEALTH_STATES.stale.label },
  { value: "partially-stale", label: "Stale in some envs" },
  {
    value: "detection-off",
    label: FEATURE_HEALTH_STATES["detection-off"].label,
  },
  {
    value: "temp-rollout",
    label: FEATURE_HEALTH_STATES["temp-rollout"].label,
  },
  {
    value: "old-temp-rollout",
    label: FEATURE_HEALTH_STATES["old-temp-rollout"].label,
  },
];

// `health:` search tokens. An old temp rollout is still a temp rollout, so
// `health:temp-rollout` matches both tiers.
export function getFeatureHealthSearchTokens(
  staleData: FeatureStaleSummary | undefined,
  neverStale?: boolean,
): FeatureHealthSearchToken[] {
  const tokens: FeatureHealthSearchToken[] = getFeatureHealthStates(
    staleData,
    neverStale,
  );
  if (tokens.includes("old-temp-rollout") && !tokens.includes("temp-rollout")) {
    tokens.push("temp-rollout");
  }
  if (!neverStale && staleData && isPartiallyStale(staleData)) {
    tokens.push("partially-stale");
  }
  return tokens;
}
