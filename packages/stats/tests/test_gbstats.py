import dataclasses
from functools import partial
from unittest import TestCase, main as unittest_main

import numpy as np
import pandas as pd

from gbstats.gbstats import (
    AnalysisSettingsForStatsEngine,
    MetricSettingsForStatsEngine,
    detect_unknown_variations,
    diff_for_daily_time_series,
    reduce_dimensionality,
    analyze_metric_df,
    get_metric_df,
    format_results,
    variation_statistic_from_metric_row,
    get_bandit_weights,
)
from gbstats.models.statistics import RegressionAdjustedStatistic, SampleMeanStatistic

DECIMALS = 9
round_ = partial(np.round, decimals=DECIMALS)

COUNT_METRIC = MetricSettingsForStatsEngine(
    id="",
    name="",
    inverse=False,
    statistic_type="mean",
    main_metric_type="count",
)

MULTI_DIMENSION_STATISTICS_DF = pd.DataFrame(
    [
        {
            "dimension": "one",
            "variation": "three",
            "main_sum": 30,
            "main_sum_squares": 869,
            "users": 12,
            "count": 15,
        },
        {
            "dimension": "one",
            "variation": "two",
            "main_sum": 3000,
            "main_sum_squares": 86900,
            "users": 1200,
            "count": 1200,
        },
        {
            "dimension": "one",
            "variation": "one",
            "main_sum": 300,
            "main_sum_squares": 869,
            "users": 120,
            "count": 120,
        },
        {
            "dimension": "one",
            "variation": "zero",
            "main_sum": 270,
            "main_sum_squares": 848.79,
            "users": 100,
            "count": 100,
        },
        {
            "dimension": "two",
            "variation": "three",
            "main_sum": 3,
            "main_sum_squares": 8069,
            "users": 12,
            "count": 15,
        },
        {
            "dimension": "two",
            "variation": "two",
            "main_sum": 7700,
            "main_sum_squares": 357001,
            "users": 2200,
            "count": 2200,
        },
        {
            "dimension": "two",
            "variation": "one",
            "main_sum": 770,
            "main_sum_squares": 3571,
            "users": 220,
            "count": 220,
        },
        {
            "dimension": "two",
            "variation": "zero",
            "main_sum": 740,
            "main_sum_squares": 3615.59,
            "users": 200,
            "count": 200,
        },
    ]
)

THIRD_DIMENSION_STATISTICS_DF = pd.DataFrame(
    [
        {
            "dimension": "three",
            "variation": "one",
            "main_sum": 222,
            "main_sum_squares": 555,
            "users": 3000,
            "count": 3000,
        },
        {
            "dimension": "three",
            "variation": "zero",
            "main_sum": 333,
            "main_sum_squares": 999,
            "users": 3001,
            "count": 3001,
        },
    ]
)

RATIO_METRIC = MetricSettingsForStatsEngine(
    id="",
    name="",
    inverse=False,
    statistic_type="ratio",
    main_metric_type="count",
    denominator_metric_type="count",
)

RATIO_STATISTICS_DF = pd.DataFrame(
    [
        {
            "dimension": "one",
            "variation": "one",
            "users": 120,
            "count": 120,
            "main_sum": 300,
            "main_sum_squares": 869,
            "denominator_sum": 500,
            "denominator_sum_squares": 800,
            "main_denominator_sum_product": -905,
        },
        {
            "dimension": "one",
            "variation": "zero",
            "main_sum": 270,
            "users": 100,
            "count": 100,
            "main_sum_squares": 848.79,
            "denominator_sum": 510,
            "denominator_sum_squares": 810,
            "main_denominator_sum_product": -900,
        },
    ]
)

RATIO_STATISTICS_ADDITIONAL_DIMENSION_DF = RATIO_STATISTICS_DF.copy()
RATIO_STATISTICS_ADDITIONAL_DIMENSION_DF["dimension"] = "fifth"

ONE_USER_DF = pd.DataFrame(
    [
        {
            "dimension": "one",
            "variation": "one",
            "main_sum": 1,
            "main_sum_squares": 1,
            "users": 1,
            "count": 1,
        },
        {
            "dimension": "one",
            "variation": "zero",
            "main_sum": 20,
            "main_sum_squares": 443,
            "users": 3,
            "count": 3,
        },
    ]
)

ZERO_DENOM_RATIO_STATISTICS_DF = pd.DataFrame(
    [
        {
            "dimension": "one",
            "variation": "one",
            "users": 120,
            "count": 120,
            "main_sum": 300,
            "main_sum_squares": 869,
            "denominator_sum": 500,
            "denominator_sum_squares": 800,
            "main_denominator_sum_product": -905,
        },
        {
            "dimension": "one",
            "variation": "zero",
            "main_sum": 270,
            "users": 100,
            "count": 100,
            "main_sum_squares": 848.79,
            "denominator_sum": 0,
            "denominator_sum_squares": 0,
            "main_denominator_sum_product": 0,
        },
    ]
)

RA_METRIC = MetricSettingsForStatsEngine(
    id="",
    name="",
    inverse=False,
    statistic_type="mean_ra",
    main_metric_type="count",
    covariate_metric_type="count",
    decision_metric=True,
)

RA_STATISTICS_DF = pd.DataFrame(
    [
        {
            "dimension": "All",
            "variation": "one",
            "main_sum": 222,
            "main_sum_squares": 555,
            "covariate_sum": 120,
            "covariate_sum_squares": 405,
            "main_covariate_sum_product": -10,
            "users": 3000,
            "count": 3000,
        },
        {
            "dimension": "All",
            "variation": "zero",
            "main_sum": 300,
            "main_sum_squares": 600,
            "covariate_sum": 210,
            "covariate_sum_squares": 415,
            "main_covariate_sum_product": -20,
            "users": 3001,
            "count": 3001,
        },
    ]
)

DEFAULT_ANALYSIS = AnalysisSettingsForStatsEngine(
    var_names=["zero", "one", "two", "three"],
    var_ids=["0", "1", "2", "3"],
    weights=[0.45, 0.4, 0.1, 0.05],
    baseline_index=0,
    dimension="All",
    stats_engine="bayesian",
    sequential_testing_enabled=False,
    sequential_tuning_parameter=5000,
    difference_type="relative",
    phase_length_days=1,
    alpha=0.05,
    max_dimensions=20,
)


class TestAnalyzeMetricDfBayesian(TestCase):
    # New usage (no mean/stddev correction)
    def test_get_metric_df_new(self):
        rows = MULTI_DIMENSION_STATISTICS_DF
        # turns sql output, which has unique row by (variation, dimension), into pd.DataFrame where each dimension has 1 row
        df = get_metric_df(
            rows,
            {"zero": 0, "one": 1, "two": 2, "three": 3},
            ["zero", "one", "two", "three"],
        )
        import copy

        result = analyze_metric_df(df, metric=COUNT_METRIC, analysis=DEFAULT_ANALYSIS)
        self.assertEqual(len(result.index), 2)
        self.assertEqual(result.at[0, "dimension"], "one")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 2.7)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 2.5)
        self.assertEqual(round_(result.at[0, "v1_risk"][1]), 0.075691131)
        self.assertEqual(round_(result.at[0, "v1_expected"]), -0.074074074)
        self.assertEqual(round_(result.at[0, "v1_prob_beat_baseline"]), 0.071834168)
        self.assertEqual(result.at[0, "v1_p_value"], None)

    def test_get_metric_df_bayesian_ratio(self):
        rows = RATIO_STATISTICS_DF
        df = get_metric_df(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(
            df=df, metric=RATIO_METRIC, analysis=DEFAULT_ANALYSIS
        )

        self.assertEqual(len(result.index), 1)
        self.assertEqual(result.at[0, "dimension"], "one")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 0.529411765)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 0.6)
        self.assertEqual(round_(result.at[0, "v1_risk"][1]), 0.050934045)
        self.assertEqual(round_(result.at[0, "v1_expected"]), 0.133333333)
        self.assertEqual(round_(result.at[0, "v1_prob_beat_baseline"]), 0.694926359)
        self.assertEqual(result.at[0, "v1_p_value"], None)

    def test_get_metric_df_inverse(self):
        rows = MULTI_DIMENSION_STATISTICS_DF
        df = get_metric_df(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(
            df,
            metric=dataclasses.replace(COUNT_METRIC, inverse=True),
            analysis=DEFAULT_ANALYSIS,
        )

        self.assertEqual(len(result.index), 2)
        self.assertEqual(result.at[0, "dimension"], "one")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 2.7)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 2.5)
        self.assertEqual(round_(result.at[0, "v1_risk"][1]), 0.001617057)
        self.assertEqual(round_(result.at[0, "v1_expected"]), -0.074074074)
        self.assertEqual(round_(result.at[0, "v1_prob_beat_baseline"]), 1 - 0.071834168)
        self.assertEqual(result.at[0, "v1_p_value"], None)

    def test_get_metric_df_zero_val(self):
        rows = ONE_USER_DF
        df = get_metric_df(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(
            df,
            metric=dataclasses.replace(COUNT_METRIC, inverse=True),
            analysis=DEFAULT_ANALYSIS,
        )

        self.assertEqual(len(result.index), 1)
        self.assertEqual(result.at[0, "dimension"], "one")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 6.666666667)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 1)
        self.assertEqual(round_(result.at[0, "v1_risk"][1]), 0)
        self.assertEqual(round_(result.at[0, "v1_expected"]), -0.85)
        self.assertEqual(round_(result.at[0, "v1_prob_beat_baseline"]), 0.5)
        self.assertEqual(result.at[0, "v1_p_value"], None)

    def test_get_metric_df_ratio_zero_denom(self):
        rows = ZERO_DENOM_RATIO_STATISTICS_DF
        df = get_metric_df(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(df, metric=RATIO_METRIC, analysis=DEFAULT_ANALYSIS)

        self.assertEqual(len(result.index), 1)
        self.assertEqual(result.at[0, "dimension"], "one")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 0)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 0.6)
        self.assertEqual(round_(result.at[0, "v1_risk"][1]), 0)
        self.assertEqual(round_(result.at[0, "v1_expected"]), 0)
        self.assertEqual(round_(result.at[0, "v1_prob_beat_baseline"]), 0.5)
        self.assertEqual(result.at[0, "v1_p_value"], None)


class TestBandit(TestCase):
    def test_get_bandit_weights(self):
        rows = MULTI_DIMENSION_STATISTICS_DF
        var_id_map = {"zero": 0, "one": 1, "two": 2, "three": 3}
        metric = COUNT_METRIC
        analysis = DEFAULT_ANALYSIS
        df_weights = get_bandit_weights(rows, var_id_map, metric, analysis)
        n_variations = len(var_id_map)
        constant_weights = np.full((n_variations,), 1 / n_variations).tolist()
        self.assertEqual(df_weights.at[0, "weights"], constant_weights)
        self.assertEqual(df_weights.at[1, "weights"], constant_weights)


class TestAnalyzeMetricDfFrequentist(TestCase):
    def test_get_metric_df_frequentist(self):
        rows = MULTI_DIMENSION_STATISTICS_DF
        df = get_metric_df(
            rows,
            {"zero": 0, "one": 1},
            ["zero", "one"],
        )
        result = analyze_metric_df(
            df,
            metric=COUNT_METRIC,
            analysis=dataclasses.replace(DEFAULT_ANALYSIS, stats_engine="frequentist"),
        )

        self.assertEqual(len(result.index), 2)
        self.assertEqual(result.at[0, "dimension"], "one")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 2.7)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 2.5)
        self.assertEqual(result.at[0, "v1_risk"], None)
        self.assertEqual(round_(result.at[0, "v1_expected"]), -0.074074074)
        self.assertEqual(result.at[0, "v1_prob_beat_baseline"], None)
        self.assertEqual(round_(result.at[0, "v1_p_value"]), 0.145219005)

    def test_get_metric_df_frequentist_ratio(self):
        rows = RATIO_STATISTICS_DF
        df = get_metric_df(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(
            df,
            metric=RATIO_METRIC,
            analysis=dataclasses.replace(DEFAULT_ANALYSIS, stats_engine="frequentist"),
        )

        self.assertEqual(len(result.index), 1)
        self.assertEqual(result.at[0, "dimension"], "one")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 0.529411765)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 0.6)
        self.assertEqual(result.at[0, "v1_risk"], None)
        self.assertEqual(round_(result.at[0, "v1_expected"]), 0.133333333)
        self.assertEqual(result.at[0, "v1_prob_beat_baseline"], None)
        self.assertEqual(round_(result.at[0, "v1_p_value"]), 0.610663339)

    def test_get_metric_df_zero_val(self):
        rows = ONE_USER_DF
        df = get_metric_df(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(
            df,
            metric=COUNT_METRIC,
            analysis=dataclasses.replace(DEFAULT_ANALYSIS, stats_engine="frequentist"),
        )

        self.assertEqual(len(result.index), 1)
        self.assertEqual(result.at[0, "dimension"], "one")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 6.666666667)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 1)
        self.assertEqual(result.at[0, "v1_risk"], None)
        self.assertEqual(round_(result.at[0, "v1_expected"]), -0.85)
        self.assertEqual(result.at[0, "v1_prob_beat_baseline"], None)
        self.assertEqual(round_(result.at[0, "v1_p_value"]), 1)

    def test_get_metric_df_ratio_zero_denom(self):
        rows = ZERO_DENOM_RATIO_STATISTICS_DF
        df = get_metric_df(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(
            df,
            metric=RATIO_METRIC,
            analysis=dataclasses.replace(DEFAULT_ANALYSIS, stats_engine="frequentist"),
        )

        self.assertEqual(len(result.index), 1)
        self.assertEqual(result.at[0, "dimension"], "one")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 0)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 0.6)
        self.assertEqual(result.at[0, "v1_risk"], None)
        self.assertEqual(round_(result.at[0, "v1_expected"]), 0)
        self.assertEqual(result.at[0, "v1_prob_beat_baseline"], None)
        self.assertEqual(round_(result.at[0, "v1_p_value"]), 1)


class TestAnalyzeMetricDfRegressionAdjustment(TestCase):
    def test_analyze_metric_df_ra(self):
        rows = RA_STATISTICS_DF
        df = get_metric_df(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(
            df,
            metric=RA_METRIC,
            analysis=dataclasses.replace(DEFAULT_ANALYSIS, stats_engine="frequentist"),
        )

        # Test that meric mean is unadjusted
        self.assertEqual(len(result.index), 1)
        self.assertEqual(result.at[0, "dimension"], "All")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 0.099966678)
        self.assertEqual(round_(result.at[0, "baseline_mean"]), 0.099966678)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 0.074)
        self.assertEqual(round_(result.at[0, "v1_mean"]), 0.074)
        self.assertEqual(result.at[0, "v1_risk"], None)
        self.assertEqual(round_(result.at[0, "v1_expected"]), -0.281707154)
        self.assertEqual(result.at[0, "v1_prob_beat_baseline"], None)
        self.assertEqual(round_(result.at[0, "v1_p_value"]), 0.003736297)
        # But difference is not just DIM / control mean, like it used to be
        self.assertNotEqual(
            np.round(result.at[0, "v1_expected"], 3),
            (0.074 - 0.110963012) / 0.110963012,
        )

    def test_analyze_metric_df_ra_proportion(self):
        rows = RA_STATISTICS_DF
        # override default DF
        rows["main_sum_squares"] = None
        rows["covariate_sum_squares"] = None
        df = get_metric_df(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(
            df,
            metric=dataclasses.replace(
                RA_METRIC,
                main_metric_type="binomial",
                covariate_metric_type="binomial",
            ),
            analysis=dataclasses.replace(DEFAULT_ANALYSIS, stats_engine="frequentist"),
        )

        # Test that metric mean is unadjusted
        self.assertEqual(len(result.index), 1)
        self.assertEqual(result.at[0, "dimension"], "All")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 0.099966678)
        self.assertEqual(round_(result.at[0, "baseline_mean"]), 0.099966678)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 0.074)
        self.assertEqual(round_(result.at[0, "v1_mean"]), 0.074)
        self.assertEqual(result.at[0, "v1_risk"], None)
        self.assertEqual(round_(result.at[0, "v1_expected"]), -0.316211568)
        self.assertEqual(result.at[0, "v1_prob_beat_baseline"], None)
        self.assertEqual(round_(result.at[0, "v1_p_value"]), 0.00000035)


class TestAnalyzeMetricDfSequential(TestCase):
    def test_analyze_metric_df_sequential(self):
        rows = MULTI_DIMENSION_STATISTICS_DF
        df = get_metric_df(
            rows,
            {"zero": 0, "one": 1},
            ["zero", "one"],
        )
        result = analyze_metric_df(
            df,
            metric=COUNT_METRIC,
            analysis=dataclasses.replace(
                DEFAULT_ANALYSIS,
                stats_engine="frequentist",
                sequential_testing_enabled=True,
                sequential_tuning_parameter=600,
            ),
        )

        self.assertEqual(len(result.index), 2)
        self.assertEqual(result.at[0, "dimension"], "one")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 2.7)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 2.5)
        self.assertEqual(result.at[0, "v1_risk"], None)
        self.assertEqual(round_(result.at[0, "v1_expected"]), -0.074074074)
        self.assertEqual(result.at[0, "v1_prob_beat_baseline"], None)
        self.assertEqual(round_(result.at[0, "v1_p_value"]), 0.892332229)
        self.assertEqual(round_(result.at[0, "v1_ci"][0]), -0.233322085)

        result_bad_tuning = analyze_metric_df(
            df,
            metric=COUNT_METRIC,
            analysis=dataclasses.replace(
                DEFAULT_ANALYSIS,
                stats_engine="frequentist",
                sequential_testing_enabled=True,
                sequential_tuning_parameter=1,
            ),
        )

        # Wider CI with lower tuning parameter to test it passes through
        self.assertTrue(result.at[0, "v1_ci"][0] > result_bad_tuning.at[0, "v1_ci"][0])


class TestFormatResults(TestCase):
    def test_format_results_denominator(self):
        rows = RATIO_STATISTICS_DF
        df = get_metric_df(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        n_variations = len(RATIO_STATISTICS_DF["variation"].unique())
        constant_weights = np.full((n_variations,), 1 / n_variations).tolist()
        df_weights = pd.DataFrame(
            {
                "dimension": ["two", "one"],
                "weights": [constant_weights, constant_weights],
                "update_message": "successfully_updated",
            }
        )
        result = format_results(
            analyze_metric_df(
                df,
                metric=COUNT_METRIC,
                analysis=dataclasses.replace(
                    DEFAULT_ANALYSIS, stats_engine="frequentist"
                ),
            ),
            df_weights,
            0,
        )
        for res in result:
            self.assertEqual(res.bandit_weights.weights, constant_weights)
            for i, v in enumerate(res.variations):
                self.assertEqual(v.denominator, 510 if i == 0 else 500)


if __name__ == "__main__":
    unittest_main()
