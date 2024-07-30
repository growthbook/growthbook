import dataclasses
from functools import partial
from unittest import TestCase, main as unittest_main

import numpy as np
import pandas as pd

from gbstats.gbstats import (
    AnalysisSettingsForStatsEngine,
    BanditSettingsForStatsEngine,
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
    id="count_metric",
    name="count_metric",
    inverse=False,
    statistic_type="mean",
    main_metric_type="count",
)

QUERY_OUTPUT = [
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

MULTI_DIMENSION_STATISTICS_DF = pd.DataFrame(QUERY_OUTPUT)

# used for testing bandits
QUERY_OUTPUT_BANDITS = [
    {
        "dimension": "",
        "period": 0,
        "variation": "zero",
        "main_sum": 270,
        "main_sum_squares": 848.79,
        "users": 100,
        "count": 100,
    },
    {
        "dimension": "",
        "period": 0,
        "variation": "one",
        "main_sum": 300,
        "main_sum_squares": 869,
        "users": 120,
        "count": 120,
    },
    {
        "dimension": "",
        "period": 0,
        "variation": "two",
        "main_sum": 740,
        "main_sum_squares": 1615.59,
        "users": 200,
        "count": 200,
    },
    {
        "dimension": "",
        "period": 0,
        "variation": "three",
        "main_sum": 770,
        "main_sum_squares": 1571,
        "users": 220,
        "count": 220,
    },
    {
        "dimension": "",
        "period": 1,
        "variation": "zero",
        "main_sum": 270,
        "main_sum_squares": 848.79,
        "users": 100,
        "count": 100,
    },
    {
        "dimension": "",
        "period": 1,
        "variation": "one",
        "main_sum": 300,
        "main_sum_squares": 869,
        "users": 120,
        "count": 120,
    },
    {
        "dimension": "",
        "period": 1,
        "variation": "two",
        "main_sum": 740,
        "main_sum_squares": 1615.59,
        "users": 200,
        "count": 200,
    },
    {
        "dimension": "",
        "period": 1,
        "variation": "three",
        "main_sum": 770,
        "main_sum_squares": 1571,
        "users": 220,
        "count": 220,
    },
]


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
    var_names=["zero", "one"],
    var_ids=["0", "1"],
    weights=[0.5, 0.5],
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

# confirm with sonnet that var_ids are right;
# before was failing at "get_metric_df" due to wrong var_id_mapping
BANDIT_ANALYSIS = BanditSettingsForStatsEngine(
    var_names=["zero", "one", "two", "three"],
    var_ids=["zero", "one", "two", "three"],
    decision_metric="count_metric",
    bandit_weights_seed=10,
)


class TestDiffDailyTS(TestCase):
    def test_diff_works_as_expected(self):
        dfc = MULTI_DIMENSION_STATISTICS_DF.copy()
        dfc["dimension"].replace(
            ["one", "two"], ["2022-01-01", "2022-01-02"], inplace=True
        )
        dfc = diff_for_daily_time_series(dfc)

        target_df = pd.DataFrame(
            [
                {
                    "dimension": "2022-01-01",
                    "variation": "one",
                    "main_sum": 300,
                    "main_sum_squares": 869,
                    "users": 120,
                    "count": 120,
                },
                {
                    "dimension": "2022-01-01",
                    "variation": "zero",
                    "main_sum": 270,
                    "main_sum_squares": 848.79,
                    "users": 100,
                    "count": 100,
                },
                {
                    "dimension": "2022-01-02",
                    "variation": "one",
                    "main_sum": 770.0 - 300,
                    "main_sum_squares": 3571 - 869,
                    "users": 220,
                    "count": 220,
                },
                {
                    "dimension": "2022-01-02",
                    "variation": "zero",
                    "main_sum": 740.0 - 270,
                    "main_sum_squares": 3615.59 - 848.79,
                    "users": 200,
                    "count": 200,
                },
            ]
        )
        pd.testing.assert_frame_equal(
            dfc.sort_values(["variation", "dimension"]).reset_index(drop=True),
            target_df.sort_values(["variation", "dimension"]).reset_index(drop=True),
        )


class TestGetMetricDf(TestCase):
    def test_get_metric_df_missing_count(self):
        rows = MULTI_DIMENSION_STATISTICS_DF.drop("count", axis=1)
        df = get_metric_df(
            rows,
            {"zero": 0, "one": 1},
            ["zero", "one"],
        )
        for i, row in df.iterrows():
            self.assertEqual(row["baseline_count"], row["baseline_users"])
            self.assertEqual(row["v1_count"], row["v1_users"])


class TestVariationStatisticBuilder(TestCase):
    def test_ra_statistic_type(self):
        test_row = pd.Series(
            {
                "statistic_type": "mean_ra",
                "baseline_main_sum": 222,
                "baseline_main_sum_squares": 555,
                "baseline_covariate_sum": 120,
                "baseline_covariate_sum_squares": 405,
                "baseline_main_covariate_sum_product": -10,
                "baseline_users": 3000,
                "baseline_count": 3000,
                "v1_main_sum": 333,
                "v1_main_sum_squares": 999,
                "v1_covariate_sum": 210,
                "v1_covariate_sum_squares": 415,
                "v1_main_covariate_sum_product": -20,
                "v1_users": 3001,
                "v1_count": 3001,
            }
        )
        baseline_stat = variation_statistic_from_metric_row(
            test_row, prefix="baseline", metric=RA_METRIC
        )
        v1_stat = variation_statistic_from_metric_row(
            test_row, prefix="v1", metric=RA_METRIC
        )
        self.assertIsInstance(baseline_stat, RegressionAdjustedStatistic)
        self.assertIsInstance(v1_stat, RegressionAdjustedStatistic)

        expected_baseline_post_stat = SampleMeanStatistic(
            n=3000, sum=222, sum_squares=555
        )
        expected_baseline_pre_stat = SampleMeanStatistic(
            n=3000, sum=120, sum_squares=405
        )
        expected_baseline_pre_post_sum_product = -10
        expected_baseline_n = 3000
        self.assertEqual(
            baseline_stat,
            RegressionAdjustedStatistic(
                post_statistic=expected_baseline_post_stat,
                pre_statistic=expected_baseline_pre_stat,
                post_pre_sum_of_products=expected_baseline_pre_post_sum_product,
                n=expected_baseline_n,
                theta=0,
            ),
        )


class TestDetectVariations(TestCase):
    def test_unknown_variations(self):
        rows = MULTI_DIMENSION_STATISTICS_DF
        self.assertEqual(detect_unknown_variations(rows, {"zero", "one"}), set())
        self.assertEqual(detect_unknown_variations(rows, {"zero", "hello"}), {"one"})
        self.assertEqual(
            detect_unknown_variations(rows, {"hello", "world"}), {"one", "zero"}
        )

    def test_multiple_exposures(self):
        rows = pd.concat(
            [
                MULTI_DIMENSION_STATISTICS_DF,
                pd.DataFrame(
                    [
                        {
                            "dimension": "All",
                            "variation": "__multiple__",
                            "main_sum": 99,
                            "main_sum_squares": 9999,
                            "users": 500,
                        }
                    ]
                ),
            ]
        )
        self.assertEqual(detect_unknown_variations(rows, {"zero", "one"}), set())
        self.assertEqual(
            detect_unknown_variations(rows, {"zero", "one"}, {"some_other"}),
            {"__multiple__"},
        )


class TestReduceDimensionality(TestCase):
    def test_reduce_dimensionality(self):
        rows = pd.concat([MULTI_DIMENSION_STATISTICS_DF, THIRD_DIMENSION_STATISTICS_DF])
        df = get_metric_df(
            rows,
            {"zero": 0, "one": 1},
            ["zero", "one"],
        )
        reduced = reduce_dimensionality(df, 3)
        self.assertEqual(len(reduced.index), 3)
        self.assertEqual(reduced.at[0, "dimension"], "three")
        self.assertEqual(reduced.at[0, "v1_main_sum"], 222)

        reduced = reduce_dimensionality(df, 2)
        self.assertEqual(len(reduced.index), 2)
        self.assertEqual(reduced.at[1, "dimension"], "(other)")
        self.assertEqual(reduced.at[1, "total_users"], 640)
        self.assertEqual(reduced.at[1, "v1_main_sum"], 1070)
        self.assertEqual(reduced.at[1, "v1_main_sum_squares"], 4440)
        self.assertEqual(reduced.at[1, "v1_users"], 340)
        self.assertEqual(reduced.at[1, "baseline_users"], 300)
        self.assertEqual(reduced.at[1, "baseline_main_sum"], 1010)
        self.assertEqual(reduced.at[1, "baseline_main_sum_squares"], 4464.38)

    def test_reduce_dimensionality_ratio(self):
        rows = pd.concat(
            [RATIO_STATISTICS_DF, RATIO_STATISTICS_ADDITIONAL_DIMENSION_DF]
        )
        df = get_metric_df(
            rows,
            {"zero": 0, "one": 1},
            ["zero", "one"],
        )

        reduced = reduce_dimensionality(df, 20)
        self.assertEqual(len(reduced.index), 2)
        self.assertEqual(reduced.at[0, "dimension"], "one")
        self.assertEqual(reduced.at[0, "total_users"], 220)
        self.assertEqual(reduced.at[0, "v1_users"], 120)
        self.assertEqual(reduced.at[0, "v1_main_sum"], 300)
        self.assertEqual(reduced.at[0, "v1_main_sum_squares"], 869)
        self.assertEqual(reduced.at[0, "v1_denominator_sum"], 500)
        self.assertEqual(reduced.at[0, "v1_denominator_sum_squares"], 800)
        self.assertEqual(reduced.at[0, "v1_main_denominator_sum_product"], -905)
        self.assertEqual(reduced.at[0, "baseline_users"], 100)
        self.assertEqual(reduced.at[0, "baseline_main_sum"], 270)
        self.assertEqual(reduced.at[0, "baseline_main_sum_squares"], 848.79)
        self.assertEqual(reduced.at[0, "baseline_denominator_sum"], 510)
        self.assertEqual(reduced.at[0, "baseline_denominator_sum_squares"], 810)
        self.assertEqual(reduced.at[0, "baseline_main_denominator_sum_product"], -900)

        reduced = reduce_dimensionality(df, 1)
        self.assertEqual(len(reduced.index), 1)
        self.assertEqual(reduced.at[0, "dimension"], "(other)")
        self.assertEqual(reduced.at[0, "total_users"], 220 * 2)
        self.assertEqual(reduced.at[0, "v1_users"], 120 * 2)
        self.assertEqual(reduced.at[0, "v1_main_sum"], 300 * 2)
        self.assertEqual(reduced.at[0, "v1_main_sum_squares"], 869 * 2)
        self.assertEqual(reduced.at[0, "v1_denominator_sum"], 500 * 2)
        self.assertEqual(reduced.at[0, "v1_denominator_sum_squares"], 800 * 2)
        self.assertEqual(reduced.at[0, "v1_main_denominator_sum_product"], -905 * 2)
        self.assertEqual(reduced.at[0, "baseline_users"], 100 * 2)
        self.assertEqual(reduced.at[0, "baseline_main_sum"], 270 * 2)
        self.assertEqual(reduced.at[0, "baseline_main_sum_squares"], 848.79 * 2)
        self.assertEqual(reduced.at[0, "baseline_denominator_sum"], 510 * 2)
        self.assertEqual(reduced.at[0, "baseline_denominator_sum_squares"], 810 * 2)
        self.assertEqual(
            reduced.at[0, "baseline_main_denominator_sum_product"], -900 * 2
        )


class TestAnalyzeMetricDfBayesian(TestCase):
    # New usage (no mean/stddev correction)
    def test_get_metric_df_new(self):
        rows = MULTI_DIMENSION_STATISTICS_DF
        df = get_metric_df(rows, {"zero": 0, "one": 1}, ["zero", "one"])
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
        result = format_results(
            analyze_metric_df(
                df,
                metric=COUNT_METRIC,
                analysis=dataclasses.replace(
                    DEFAULT_ANALYSIS, stats_engine="frequentist"
                ),
            ),
            0,
        )
        for res in result:
            for i, v in enumerate(res.variations):
                self.assertEqual(v.denominator, 510 if i == 0 else 500)


class TestBandit(TestCase):
    def setUp(self):
        # preprocessing steps
        self.rows = QUERY_OUTPUT_BANDITS
        self.metric = COUNT_METRIC
        self.analysis = BANDIT_ANALYSIS
        self.update_messages = [
            "successfully updated",
        ]
        self.true_weights = [0.37530, 0.13345, 0.24645, 0.2448]

    def test_get_bandit_weights(self):
        result = get_bandit_weights(self.rows, self.metric, self.analysis)
        self.assertEqual(result.banditUpdateMessage, self.update_messages[0])
        self.assertEqual(result.banditWeights, self.true_weights)


if __name__ == "__main__":
    unittest_main()
