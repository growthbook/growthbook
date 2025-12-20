// Always max to 200 metrics per query
export const MAX_METRICS_PER_QUERY = 200;

export const N_STAR_VALUES = [
  100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600, 51200, 102400, 204800,
  409600, 819200, 1638400, 3276800, 6553600, 13107200, 26214400, 52428800,
];

export const BASE_METRIC_FLOAT_COLS = [
  "main_sum",
  "main_sum_squares",
  "main_cap_value",
  "denominator_cap_value",
  "covariate_sum",
  "covariate_sum_squares",
  "main_covariate_sum_product",
  "theta",
];

export const RATIO_METRIC_FLOAT_COLS = [
  ...BASE_METRIC_FLOAT_COLS,
  "denominator_sum",
  "denominator_sum_squares",
  "main_denominator_sum_product",
  "denominator_pre_sum",
  "denominator_pre_sum_squares",
  "main_post_denominator_pre_sum_product",
  "main_pre_denominator_post_sum_product",
  "main_pre_denominator_pre_sum_product",
  "denominator_post_denominator_pre_sum_product",
];

export const ALL_NON_QUANTILE_METRIC_FLOAT_COLS = RATIO_METRIC_FLOAT_COLS;
