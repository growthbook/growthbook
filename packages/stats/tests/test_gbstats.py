from functools import partial
from unittest import TestCase, main as unittest_main

import numpy as np
import pandas as pd

from gbstats.gbstats import (
    base_statistic_from_metric_row,
    detect_unknown_variations,
    diff_for_daily_time_series,
    reduce_dimensionality,
    analyze_metric_df,
    get_metric_df,
    format_results,
    variation_statistic_from_metric_row,
)
from gbstats.messages import RA_NOT_COMPATIBLE_WITH_BAYESIAN_ERROR
from gbstats.shared.constants import StatsEngine
from gbstats.shared.models import (
    RegressionAdjustedStatistic,
    SampleMeanStatistic,
)

DECIMALS = 9
round_ = partial(np.round, decimals=DECIMALS)

MULTI_DIMENSION_STATISTICS_DF = pd.DataFrame(
    [
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
).assign(statistic_type="mean", main_metric_type="count")

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
).assign(statistic_type="mean", main_metric_type="count")

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
).assign(
    statistic_type="ratio", main_metric_type="count", denominator_metric_type="count"
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
).assign(statistic_type="mean", main_metric_type="count")


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
).assign(
    statistic_type="ratio", main_metric_type="count", denominator_metric_type="count"
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
).assign(
    statistic_type="mean_ra", main_metric_type="count", covariate_metric_type="count"
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
        ).assign(statistic_type="mean", main_metric_type="count")
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


class TestBaseStatisticBuilder(TestCase):
    def test_unknown_metric_type(self):
        with self.assertRaisesRegex(ValueError, expected_regex="metric_type.*not_real"):
            base_statistic_from_metric_row(
                pd.Series({"test_metric_type": "not_real"}), prefix="", component="test"
            )

    # TODO add more unit tests in follow-up PR


class TestVariationStatisticBuilder(TestCase):
    def test_unknown_statistic_type(self):
        with self.assertRaisesRegex(
            ValueError, expected_regex="statistic_type.*not_real.*"
        ):
            variation_statistic_from_metric_row(
                pd.Series({"statistic_type": "not_real"}), prefix=""
            )

    def test_ra_statistic_type(self):
        test_row = pd.Series(
            {
                "statistic_type": "mean_ra",
                "main_metric_type": "count",
                "covariate_metric_type": "count",
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
        baseline_stat = variation_statistic_from_metric_row(test_row, prefix="baseline")
        v1_stat = variation_statistic_from_metric_row(test_row, prefix="v1")
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
        self.assertEqual(detect_unknown_variations(rows, {"zero": 0, "one": 1}), set())
        self.assertEqual(
            detect_unknown_variations(rows, {"zero": 0, "hello": 1}), {"one"}
        )
        self.assertEqual(
            detect_unknown_variations(rows, {"hello": 0, "world": 1}), {"one", "zero"}
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
        self.assertEqual(detect_unknown_variations(rows, {"zero": 0, "one": 1}), set())
        self.assertEqual(
            detect_unknown_variations(rows, {"zero": 0, "one": 1}, {"some_other"}),
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
        result = analyze_metric_df(df, [0.5, 0.5])

        self.assertEqual(len(result.index), 2)
        self.assertEqual(result.at[0, "dimension"], "one")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 2.7)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 2.5)
        self.assertEqual(round_(result.at[0, "v1_rawrisk"][1]), 0.2052515)
        self.assertEqual(round_(result.at[0, "v1_expected"]), -0.074074074)
        self.assertEqual(round_(result.at[0, "v1_prob_beat_baseline"]), 0.079755378)
        self.assertEqual(result.at[0, "v1_p_value"], None)

    def test_get_metric_df_bayesian_ratio(self):
        rows = RATIO_STATISTICS_DF
        df = get_metric_df(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(df=df, weights=[0.5, 0.5], inverse=False)

        self.assertEqual(len(result.index), 1)
        self.assertEqual(result.at[0, "dimension"], "one")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 0.529411765)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 0.6)
        self.assertEqual(round_(result.at[0, "v1_rawrisk"][1]), 0.024065883)
        self.assertEqual(round_(result.at[0, "v1_expected"]), 0.133333333)
        self.assertEqual(round_(result.at[0, "v1_prob_beat_baseline"]), 0.706241155)
        self.assertEqual(result.at[0, "v1_p_value"], None)

    def test_get_metric_df_inverse(self):
        rows = MULTI_DIMENSION_STATISTICS_DF
        df = get_metric_df(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(df, [0.5, 0.5], inverse=True)

        self.assertEqual(len(result.index), 2)
        self.assertEqual(result.at[0, "dimension"], "one")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 2.7)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 2.5)
        self.assertEqual(round_(result.at[0, "v1_rawrisk"][1]), 0.2052515)
        self.assertEqual(round_(result.at[0, "v1_expected"]), -0.074074074)
        self.assertEqual(round_(result.at[0, "v1_prob_beat_baseline"]), 1 - 0.079755378)
        self.assertEqual(result.at[0, "v1_p_value"], None)

    def test_get_metric_df_zero_val(self):
        rows = ONE_USER_DF
        df = get_metric_df(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(df, [0.5, 0.5], inverse=True)

        self.assertEqual(len(result.index), 1)
        self.assertEqual(result.at[0, "dimension"], "one")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 6.666666667)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 1)
        self.assertEqual(round_(result.at[0, "v1_rawrisk"][1]), 0)
        self.assertEqual(round_(result.at[0, "v1_expected"]), -0.85)
        self.assertEqual(round_(result.at[0, "v1_prob_beat_baseline"]), 0.5)
        self.assertEqual(result.at[0, "v1_p_value"], None)

    def test_get_metric_df_ratio_zero_denom(self):
        rows = ZERO_DENOM_RATIO_STATISTICS_DF
        df = get_metric_df(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(
            df=df, weights=[0.5, 0.5], inverse=False, engine=StatsEngine.BAYESIAN
        )

        self.assertEqual(len(result.index), 1)
        self.assertEqual(result.at[0, "dimension"], "one")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 0)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 0.6)
        self.assertEqual(round_(result.at[0, "v1_rawrisk"][1]), 0)
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
            df=df, weights=[0.5, 0.5], inverse=False, engine=StatsEngine.FREQUENTIST
        )

        self.assertEqual(len(result.index), 2)
        self.assertEqual(result.at[0, "dimension"], "one")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 2.7)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 2.5)
        self.assertEqual(result.at[0, "v1_rawrisk"], None)
        self.assertEqual(round_(result.at[0, "v1_expected"]), -0.074074074)
        self.assertEqual(result.at[0, "v1_prob_beat_baseline"], None)
        self.assertEqual(round_(result.at[0, "v1_p_value"]), 0.145219005)

    def test_get_metric_df_frequentist_ratio(self):
        rows = RATIO_STATISTICS_DF
        df = get_metric_df(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(
            df=df, weights=[0.5, 0.5], inverse=False, engine=StatsEngine.FREQUENTIST
        )

        self.assertEqual(len(result.index), 1)
        self.assertEqual(result.at[0, "dimension"], "one")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 0.529411765)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 0.6)
        self.assertEqual(result.at[0, "v1_rawrisk"], None)
        self.assertEqual(round_(result.at[0, "v1_expected"]), 0.133333333)
        self.assertEqual(result.at[0, "v1_prob_beat_baseline"], None)
        self.assertEqual(round_(result.at[0, "v1_p_value"]), 0.610663339)

    def test_get_metric_df_zero_val(self):
        rows = ONE_USER_DF
        df = get_metric_df(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(
            df=df, weights=[0.5, 0.5], inverse=False, engine=StatsEngine.FREQUENTIST
        )

        self.assertEqual(len(result.index), 1)
        self.assertEqual(result.at[0, "dimension"], "one")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 6.666666667)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 1)
        self.assertEqual(result.at[0, "v1_rawrisk"], None)
        self.assertEqual(round_(result.at[0, "v1_expected"]), -0.85)
        self.assertEqual(result.at[0, "v1_prob_beat_baseline"], None)
        self.assertEqual(round_(result.at[0, "v1_p_value"]), 1)

    def test_get_metric_df_ratio_zero_denom(self):
        rows = ZERO_DENOM_RATIO_STATISTICS_DF
        df = get_metric_df(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(
            df=df, weights=[0.5, 0.5], inverse=False, engine=StatsEngine.FREQUENTIST
        )

        self.assertEqual(len(result.index), 1)
        self.assertEqual(result.at[0, "dimension"], "one")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 0)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 0.6)
        self.assertEqual(result.at[0, "v1_rawrisk"], None)
        self.assertEqual(round_(result.at[0, "v1_expected"]), 0)
        self.assertEqual(result.at[0, "v1_prob_beat_baseline"], None)
        self.assertEqual(round_(result.at[0, "v1_p_value"]), 1)


class TestAnalyzeMetricDfRegressionAdjustment(TestCase):
    def test_analyze_metric_df_ra(self):
        rows = RA_STATISTICS_DF
        df = get_metric_df(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(
            df=df, weights=[0.5, 0.5], inverse=False, engine=StatsEngine.FREQUENTIST
        )

        # Test that meric mean is unadjusted
        self.assertEqual(len(result.index), 1)
        self.assertEqual(result.at[0, "dimension"], "All")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 0.099966678)
        self.assertEqual(round_(result.at[0, "baseline_mean"]), 0.099966678)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 0.074)
        self.assertEqual(round_(result.at[0, "v1_mean"]), 0.074)
        self.assertEqual(result.at[0, "v1_rawrisk"], None)
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
        rows["main_metric_type"] = "binomial"
        rows["covariate_metric_type"] = "binomial"
        rows["main_sum_squares"] = None
        rows["covariate_sum_squares"] = None
        df = get_metric_df(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(
            df=df, weights=[0.5, 0.5], inverse=False, engine=StatsEngine.FREQUENTIST
        )

        # Test that meric mean is unadjusted
        self.assertEqual(len(result.index), 1)
        self.assertEqual(result.at[0, "dimension"], "All")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 0.099966678)
        self.assertEqual(round_(result.at[0, "baseline_mean"]), 0.099966678)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 0.074)
        self.assertEqual(round_(result.at[0, "v1_mean"]), 0.074)
        self.assertEqual(result.at[0, "v1_rawrisk"], None)
        self.assertEqual(round_(result.at[0, "v1_expected"]), -0.316211568)
        self.assertEqual(result.at[0, "v1_prob_beat_baseline"], None)
        self.assertEqual(round_(result.at[0, "v1_p_value"]), 0.00000035)

    def test_analyze_metric_df_ra_errors_bayesian(self):
        rows = RA_STATISTICS_DF
        df = get_metric_df(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        with self.assertRaisesRegex(
            ValueError, expected_regex=RA_NOT_COMPATIBLE_WITH_BAYESIAN_ERROR
        ):
            analyze_metric_df(
                df=df, weights=[0.5, 0.5], inverse=False, engine=StatsEngine.BAYESIAN
            )


class TestAnalyzeMetricDfSequential(TestCase):
    def test_analyze_metric_df_sequential(self):
        rows = MULTI_DIMENSION_STATISTICS_DF
        df = get_metric_df(
            rows,
            {"zero": 0, "one": 1},
            ["zero", "one"],
        )
        result = analyze_metric_df(
            df=df,
            weights=[0.5, 0.5],
            inverse=False,
            engine=StatsEngine.FREQUENTIST,
            engine_config={"sequential": True, "sequential_tuning_parameter": 600},
        )

        self.assertEqual(len(result.index), 2)
        self.assertEqual(result.at[0, "dimension"], "one")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 2.7)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 2.5)
        self.assertEqual(result.at[0, "v1_rawrisk"], None)
        self.assertEqual(round_(result.at[0, "v1_expected"]), -0.074074074)
        self.assertEqual(result.at[0, "v1_prob_beat_baseline"], None)
        self.assertEqual(round_(result.at[0, "v1_p_value"]), 0.892332229)
        self.assertEqual(round_(result.at[0, "v1_ci"][0]), -0.233322085)

        result_bad_tuning = analyze_metric_df(
            df=df,
            weights=[0.5, 0.5],
            inverse=False,
            engine=StatsEngine.FREQUENTIST,
            engine_config={"sequential": True, "sequential_tuning_parameter": 1},
        )

        # Wider CI with lower tuning parameter to test it passes through
        self.assertTrue(result.at[0, "v1_ci"][0] > result_bad_tuning.at[0, "v1_ci"][0])


class TestFormatResults(TestCase):
    def test_format_results_denominator(self):
        rows = RATIO_STATISTICS_DF
        df = get_metric_df(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = format_results(
            analyze_metric_df(
                df=df, weights=[0.5, 0.5], inverse=False, engine=StatsEngine.FREQUENTIST
            )
        )
        for res in result:
            for i, v in enumerate(res["variations"]):
                self.assertEqual(v["denominator"], 510 if i == 0 else 500)


if __name__ == "__main__":
    unittest_main()
