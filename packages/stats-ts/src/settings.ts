export type DifferenceType = "relative" | "absolute" | "scaled";
export type StatsEngine = "bayesian" | "frequentist";
export type UnadjustedStatisticType =
  | "ratio"
  | "mean"
  | "quantile_event"
  | "quantile_unit";
export type RegressionAdjustedStatisticType = "ratio_ra" | "mean_ra";
export type StatisticType =
  | UnadjustedStatisticType
  | RegressionAdjustedStatisticType;
export type MetricType = "binomial" | "count" | "quantile";
export type BusinessMetricType = "goal" | "guardrail" | "secondary";

export const CONTEXTUAL_BANDIT_DIMENSION_COLUMN = "dimension";
export const CONTEXTUAL_BANDIT_DIMENSION_VALUE = "All";

const DEFAULT_BANDIT_WEIGHTS_SEED = 100;

export type AnalysisSettingsForStatsEngineInit = {
  var_names: string[];
  var_ids: string[];
  weights: number[];
  baseline_index?: number;
  dimension?: string;
  stats_engine?: StatsEngine;
  p_value_corrected?: boolean;
  sequential_testing_enabled?: boolean;
  sequential_tuning_parameter?: number;
  difference_type?: DifferenceType;
  phase_length_days?: number;
  alpha?: number;
  max_dimensions?: number;
  traffic_percentage?: number;
  num_goal_metrics?: number;
  num_guardrail_metrics?: number;
  one_sided_intervals?: boolean;
  use_covariate_as_response?: boolean;
  post_stratification_enabled?: boolean;
};

export class AnalysisSettingsForStatsEngine {
  var_names: string[];
  var_ids: string[];
  weights: number[];
  baseline_index: number;
  dimension: string;
  stats_engine: StatsEngine;
  p_value_corrected: boolean;
  sequential_testing_enabled: boolean;
  sequential_tuning_parameter: number;
  difference_type: DifferenceType;
  phase_length_days: number;
  alpha: number;
  max_dimensions: number;
  traffic_percentage: number;
  num_goal_metrics: number;
  num_guardrail_metrics: number;
  one_sided_intervals: boolean;
  use_covariate_as_response: boolean;
  post_stratification_enabled: boolean;

  constructor(args: AnalysisSettingsForStatsEngineInit) {
    this.var_names = args.var_names;
    this.var_ids = args.var_ids;
    this.weights = args.weights;
    this.baseline_index = args.baseline_index ?? 0;
    this.dimension = args.dimension ?? "";
    this.stats_engine = args.stats_engine ?? "bayesian";
    this.p_value_corrected = args.p_value_corrected ?? false;
    this.sequential_testing_enabled = args.sequential_testing_enabled ?? false;
    this.sequential_tuning_parameter = args.sequential_tuning_parameter ?? 5000;
    this.difference_type = args.difference_type ?? "relative";
    this.phase_length_days = args.phase_length_days ?? 1;
    this.alpha = args.alpha ?? 0.05;
    this.max_dimensions = args.max_dimensions ?? 20;
    this.traffic_percentage = args.traffic_percentage ?? 1;
    this.num_goal_metrics = args.num_goal_metrics ?? 1;
    this.num_guardrail_metrics = args.num_guardrail_metrics ?? 0;
    this.one_sided_intervals = args.one_sided_intervals ?? false;
    this.use_covariate_as_response = args.use_covariate_as_response ?? false;
    this.post_stratification_enabled =
      args.post_stratification_enabled ?? false;
  }
}

export type BanditWeightsSinglePeriod = {
  date: string;
  weights: number[];
  total_users: number;
};

export type BanditSettingsForStatsEngineInit = {
  var_names: string[];
  var_ids: string[];
  current_weights: number[];
  reweight?: boolean;
  decision_metric?: string;
  bandit_weights_seed?: number;
  weight_by_period?: boolean;
  top_two?: boolean;
};

export class BanditSettingsForStatsEngine {
  var_names: string[];
  var_ids: string[];
  current_weights: number[];
  reweight: boolean;
  decision_metric: string;
  bandit_weights_seed: number;
  weight_by_period: boolean;
  top_two: boolean;

  constructor(args: BanditSettingsForStatsEngineInit) {
    this.var_names = args.var_names;
    this.var_ids = args.var_ids;
    this.current_weights = args.current_weights;
    this.reweight = args.reweight ?? true;
    this.decision_metric = args.decision_metric ?? "";
    this.bandit_weights_seed =
      args.bandit_weights_seed ?? DEFAULT_BANDIT_WEIGHTS_SEED;
    this.weight_by_period = args.weight_by_period ?? true;
    this.top_two = args.top_two ?? false;
  }
}

export type ContextualBanditSettingsForStatsEngineInit =
  BanditSettingsForStatsEngineInit & {
    attributes?: string[];
    max_leaves?: number;
    current_contextual_weights?: Record<string, number[]>;
  };

export class ContextualBanditSettingsForStatsEngine extends BanditSettingsForStatsEngine {
  attributes: string[];
  max_leaves: number;
  current_contextual_weights: Record<string, number[]>;

  constructor(args: ContextualBanditSettingsForStatsEngineInit) {
    super(args);
    this.attributes = args.attributes ?? [];
    this.max_leaves = args.max_leaves ?? 12;
    this.current_contextual_weights = args.current_contextual_weights ?? {};

    if (this.attributes.length === 0) {
      throw new Error("attributes must be non-empty");
    }
  }
}

export type ExperimentMetricQueryResponseRows = Record<
  string,
  string | number
>[];
export type VarIdMap = Record<string, number>;

export type QueryResultsForStatsEngine = {
  rows: ExperimentMetricQueryResponseRows;
  metrics: (string | null)[];
  sql?: string | null;
};

export type MetricSettingsForStatsEngineInit = {
  id: string;
  name: string;
  statistic_type: StatisticType;
  main_metric_type: MetricType;
  inverse?: boolean;
  prior_proper?: boolean;
  prior_mean?: number;
  prior_stddev?: number;
  keep_theta?: boolean;
  denominator_metric_type?: MetricType | null;
  covariate_metric_type?: MetricType | null;
  quantile_value?: number | null;
  business_metric_type?: BusinessMetricType[] | null;
  target_mde?: number;
  compute_uncapped_metric?: boolean;
};

export class MetricSettingsForStatsEngine {
  id: string;
  name: string;
  statistic_type: StatisticType;
  main_metric_type: MetricType;
  inverse: boolean;
  prior_proper: boolean;
  prior_mean: number;
  prior_stddev: number;
  keep_theta: boolean;
  denominator_metric_type: MetricType | null;
  covariate_metric_type: MetricType | null;
  quantile_value: number | null;
  business_metric_type: BusinessMetricType[] | null;
  target_mde: number;
  compute_uncapped_metric: boolean;

  constructor(args: MetricSettingsForStatsEngineInit) {
    this.id = args.id;
    this.name = args.name;
    this.statistic_type = args.statistic_type;
    this.main_metric_type = args.main_metric_type;
    this.inverse = args.inverse ?? false;
    this.prior_proper = args.prior_proper ?? false;
    this.prior_mean = args.prior_mean ?? 0;
    this.prior_stddev = args.prior_stddev ?? 0.1;
    this.keep_theta = args.keep_theta ?? false;
    this.denominator_metric_type = args.denominator_metric_type ?? null;
    this.covariate_metric_type = args.covariate_metric_type ?? null;
    this.quantile_value = args.quantile_value ?? null;
    this.business_metric_type = args.business_metric_type ?? null;
    this.target_mde = args.target_mde ?? 0.01;
    this.compute_uncapped_metric = args.compute_uncapped_metric ?? false;
  }
}

export type DataForStatsEngine = {
  metrics: Record<string, MetricSettingsForStatsEngine>;
  analyses: AnalysisSettingsForStatsEngine[];
  query_results: QueryResultsForStatsEngine[];
  bandit_settings: BanditSettingsForStatsEngine | null;
  contextual_bandit_settings: ContextualBanditSettingsForStatsEngine | null;
};

export type ExperimentDataForStatsEngine = {
  id: string;
  data: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readSeed(raw: Record<string, unknown>): number {
  const seed = raw["bandit_weights_seed"];
  return seed === undefined || seed === null
    ? DEFAULT_BANDIT_WEIGHTS_SEED
    : Math.trunc(Number(seed));
}

/** Build a `BanditSettingsForStatsEngine` from the payload, or null when absent. */
export function getBanditSettings(
  data: Record<string, unknown>,
): BanditSettingsForStatsEngine | null {
  const raw = asRecord(data["bandit_settings"]);
  if (raw === null) return null;

  return new BanditSettingsForStatsEngine({
    var_names: (raw["var_names"] as string[]) ?? [],
    var_ids: (raw["var_ids"] as string[]) ?? [],
    current_weights: (raw["current_weights"] as number[]) ?? [],
    reweight: raw["reweight"] as boolean | undefined,
    decision_metric: raw["decision_metric"] as string | undefined,
    weight_by_period: raw["weight_by_period"] as boolean | undefined,
    top_two: raw["top_two"] as boolean | undefined,
    bandit_weights_seed: readSeed(raw),
  });
}

/** Build `ContextualBanditSettingsForStatsEngine` from payload; throws on shape mismatch. */
export function getContextualBanditSettings(
  data: Record<string, unknown>,
): ContextualBanditSettingsForStatsEngine | null {
  const raw = asRecord(data["contextual_bandit_settings"]);
  if (raw === null) return null;

  return new ContextualBanditSettingsForStatsEngine({
    var_names: (raw["var_names"] as string[]) ?? [],
    var_ids: (raw["var_ids"] as string[]) ?? [],
    current_weights: (raw["current_weights"] as number[]) ?? [],
    reweight: raw["reweight"] as boolean | undefined,
    decision_metric: raw["decision_metric"] as string | undefined,
    weight_by_period: raw["weight_by_period"] as boolean | undefined,
    top_two: raw["top_two"] as boolean | undefined,
    attributes: (raw["attributes"] as string[]) ?? [],
    max_leaves: raw["max_leaves"] as number | undefined,
    current_contextual_weights: raw["current_contextual_weights"] as
      | Record<string, number[]>
      | undefined,
    bandit_weights_seed: readSeed(raw),
  });
}
