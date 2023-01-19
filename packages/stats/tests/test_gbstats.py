import math
from functools import partial
from unittest import TestCase, main as unittest_main

import numpy as np
import pandas as pd

from gbstats.gbstats import (
    check_srm,
    get_adjusted_stats,
    correctMean,
    correctStddev,
    detect_unknown_variations,
    reduce_dimensionality,
    analyze_metric_df,
    get_metric_df,
)
from gbstats.shared.constants import StatsEngine

DECIMALS = 9
round_ = partial(np.round, decimals=DECIMALS)


class TestHelpers(TestCase):
    def test_srm(self):
        p = check_srm([1000, 1200], [0.5, 0.5])
        self.assertEqual(round_(p), 0.000020079)

    def test_correct_stddev(self):
        s = correctStddev(100, 10, 5, 150, 15, 3)
        self.assertEqual(round_(s), 4.620540833)
        s = correctStddev(0, 0, 0, 1, 15, 0)
        self.assertEqual(s, 0)

    def test_correct_mean(self):
        m = correctMean(100, 10, 150, 15)
        self.assertEqual(m, 13)
        m = correctMean(0, 0, 1, 15)
        self.assertEqual(m, 15)


class TestDetectVariations(TestCase):
    def test_unknown_variations(self):
        rows = pd.DataFrame(
            [
                {
                    "dimension": "All",
                    "variation": "one",
                    "count": 120,
                    "mean": 2.5,
                    "stddev": 1,
                    "users": 1000,
                },
                {
                    "dimension": "All",
                    "variation": "zero",
                    "count": 100,
                    "mean": 2.7,
                    "stddev": 1.1,
                    "users": 1100,
                },
            ]
        )
        self.assertEqual(detect_unknown_variations(rows, {"zero": 0, "one": 1}), set())
        self.assertEqual(
            detect_unknown_variations(rows, {"zero": 0, "hello": 1}), {"one"}
        )
        self.assertEqual(
            detect_unknown_variations(rows, {"hello": 0, "world": 1}), {"one", "zero"}
        )

    def test_multiple_exposures(self):
        rows = pd.DataFrame(
            [
                {
                    "dimension": "All",
                    "variation": "one",
                    "count": 120,
                    "mean": 2.5,
                    "stddev": 1,
                    "users": 1000,
                },
                {
                    "dimension": "All",
                    "variation": "two",
                    "count": 100,
                    "mean": 2.7,
                    "stddev": 1.1,
                    "users": 1100,
                },
                {
                    "dimension": "All",
                    "variation": "__multiple__",
                    "count": 50,
                    "mean": 2.7,
                    "stddev": 1.1,
                    "users": 500,
                },
            ]
        )
        self.assertEqual(detect_unknown_variations(rows, {"one": 0, "two": 1}), set())
        self.assertEqual(
            detect_unknown_variations(rows, {"one": 0, "two": 1}, {"some_other"}),
            {"__multiple__"},
        )


class TestReduceDimensionality(TestCase):
    def test_reduce_dimensionality(self):
        rows = pd.DataFrame(
            [
                {
                    "dimension": "one",
                    "variation": "one",
                    "count": 120,
                    "mean": 2.5,
                    "stddev": 1,
                    "users": 1000,
                },
                {
                    "dimension": "one",
                    "variation": "zero",
                    "count": 100,
                    "mean": 2.7,
                    "stddev": 1.1,
                    "users": 1100,
                },
                {
                    "dimension": "two",
                    "variation": "one",
                    "count": 220,
                    "mean": 3.5,
                    "stddev": 2,
                    "users": 2000,
                },
                {
                    "dimension": "two",
                    "variation": "zero",
                    "count": 200,
                    "mean": 3.7,
                    "stddev": 2.1,
                    "users": 2100,
                },
                {
                    "dimension": "three",
                    "variation": "one",
                    "count": 320,
                    "mean": 4.5,
                    "stddev": 3,
                    "users": 3000,
                },
                {
                    "dimension": "three",
                    "variation": "zero",
                    "count": 300,
                    "mean": 4.7,
                    "stddev": 3.1,
                    "users": 3100,
                },
            ]
        )
        df = get_metric_df(
            rows, {"zero": 0, "one": 1}, ["zero", "one"], True, "revenue"
        )
        reduced = reduce_dimensionality(df, 3)
        print(reduced)
        self.assertEqual(len(reduced.index), 3)
        self.assertEqual(reduced.at[0, "dimension"], "three")
        self.assertEqual(reduced.at[0, "v1_mean"], 4.5)
        self.assertEqual(reduced.at[0, "v1_stddev"], 3.0)
        self.assertEqual(reduced.at[0, "v1_total"], 1440.0)

        reduced = reduce_dimensionality(df, 2)
        print(reduced)
        self.assertEqual(len(reduced.index), 2)
        self.assertEqual(reduced.at[1, "dimension"], "(other)")
        self.assertEqual(round_(reduced.at[1, "v1_mean"]), 3.147058824)
        self.assertEqual(round_(reduced.at[1, "v1_stddev"]), 1.778805952)
        self.assertEqual(reduced.at[1, "total_users"], 640)
        self.assertEqual(reduced.at[1, "v1_users"], 340)
        self.assertEqual(reduced.at[1, "v1_total"], 1070)
        self.assertEqual(reduced.at[1, "baseline_users"], 300)
        self.assertEqual(reduced.at[1, "baseline_total"], 1010)


class TestAnalyzeMetricDfBayesian(TestCase):
    # New usage (no mean/stddev correction)
    def test_get_metric_df_new(self):
        rows = pd.DataFrame(
            [
                {
                    "dimension": "one",
                    "variation": "one",
                    "count": 120,
                    "mean": 2.5,
                    "stddev": 1,
                    "users": 120,
                },
                {
                    "dimension": "one",
                    "variation": "zero",
                    "count": 100,
                    "mean": 2.7,
                    "stddev": 1.1,
                    "users": 100,
                },
                {
                    "dimension": "two",
                    "variation": "one",
                    "count": 220,
                    "mean": 3.5,
                    "stddev": 2,
                    "users": 220,
                },
                {
                    "dimension": "two",
                    "variation": "zero",
                    "count": 200,
                    "mean": 3.7,
                    "stddev": 2.1,
                    "users": 200,
                },
            ]
        )
        df = get_metric_df(
            rows, {"zero": 0, "one": 1}, ["zero", "one"], False, "revenue", False
        )
        result = analyze_metric_df(df, [0.5, 0.5], "revenue", False)

        self.assertEqual(len(result.index), 2)
        self.assertEqual(result.at[0, "dimension"], "one")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 2.7)
        self.assertEqual(round_(result.at[0, "baseline_risk"]), 0.0021006)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 2.5)
        self.assertEqual(round_(result.at[0, "v1_risk"]), 0.0821006)
        self.assertEqual(round_(result.at[0, "v1_expected"]), -0.074074074)
        self.assertEqual(round_(result.at[0, "v1_prob_beat_baseline"]), 0.079755378)
        self.assertEqual(result.at[0, "v1_p_value"], None)

    def test_get_metric_df_inverse(self):
        rows = pd.DataFrame(
            [
                {
                    "dimension": "one",
                    "variation": "one",
                    "count": 120,
                    "mean": 2.5,
                    "stddev": 1,
                    "users": 120,
                },
                {
                    "dimension": "one",
                    "variation": "zero",
                    "count": 100,
                    "mean": 2.7,
                    "stddev": 1.1,
                    "users": 100,
                },
                {
                    "dimension": "two",
                    "variation": "one",
                    "count": 220,
                    "mean": 3.5,
                    "stddev": 2,
                    "users": 220,
                },
                {
                    "dimension": "two",
                    "variation": "zero",
                    "count": 200,
                    "mean": 3.7,
                    "stddev": 2.1,
                    "users": 200,
                },
            ]
        )
        df = get_metric_df(
            rows, {"zero": 0, "one": 1}, ["zero", "one"], False, "revenue", False
        )
        result = analyze_metric_df(df, [0.5, 0.5], "revenue", inverse=True)

        self.assertEqual(len(result.index), 2)
        self.assertEqual(result.at[0, "dimension"], "one")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 2.7)
        self.assertEqual(round_(result.at[0, "baseline_risk"]), 0.0821006)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 2.5)
        self.assertEqual(round_(result.at[0, "v1_risk"]), 0.0021006)
        self.assertEqual(round_(result.at[0, "v1_expected"]), -0.074074074)
        self.assertEqual(round_(result.at[0, "v1_prob_beat_baseline"]), 1 - 0.079755378)
        self.assertEqual(result.at[0, "v1_p_value"], None)

    # Legacy usage needed mean/stddev to be corrected
    def test_analyze_metric_df_legacy(self):
        rows = pd.DataFrame(
            [
                {
                    "dimension": "one",
                    "variation": "one",
                    "count": 120,
                    "mean": 2.5,
                    "stddev": 1,
                    "users": 1000,
                },
                {
                    "dimension": "one",
                    "variation": "zero",
                    "count": 100,
                    "mean": 2.7,
                    "stddev": 1.1,
                    "users": 1100,
                },
                {
                    "dimension": "two",
                    "variation": "one",
                    "count": 220,
                    "mean": 3.5,
                    "stddev": 2,
                    "users": 2000,
                },
                {
                    "dimension": "two",
                    "variation": "zero",
                    "count": 200,
                    "mean": 3.7,
                    "stddev": 2.1,
                    "users": 2100,
                },
            ]
        )
        df = get_metric_df(
            rows, {"zero": 0, "one": 1}, ["zero", "one"], False, "revenue"
        )
        result = analyze_metric_df(df, [0.5, 0.5], "revenue", False)

        self.assertEqual(len(result.index), 2)
        self.assertEqual(result.at[0, "dimension"], "one")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 0.245454545)
        self.assertEqual(round_(result.at[0, "baseline_risk"]), 0.186006962)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 0.3)
        self.assertEqual(round_(result.at[0, "v1_risk"]), 0.00418878)
        self.assertEqual(round_(result.at[0, "v1_expected"]), 0.222222222)
        self.assertEqual(round_(result.at[0, "v1_prob_beat_baseline"]), 0.925127213)
        self.assertEqual(result.at[0, "v1_p_value"], None)


class TestAnalyzeMetricDfFrequentist(TestCase):
    def test_get_metric_df_frequentist(self):
        rows = pd.DataFrame(
            [
                {
                    "dimension": "one",
                    "variation": "one",
                    "count": 120,
                    "mean": 2.5,
                    "stddev": 1,
                    "users": 120,
                },
                {
                    "dimension": "one",
                    "variation": "zero",
                    "count": 100,
                    "mean": 2.7,
                    "stddev": 1.1,
                    "users": 100,
                },
                {
                    "dimension": "two",
                    "variation": "one",
                    "count": 220,
                    "mean": 3.5,
                    "stddev": 2,
                    "users": 220,
                },
                {
                    "dimension": "two",
                    "variation": "zero",
                    "count": 200,
                    "mean": 3.7,
                    "stddev": 2.1,
                    "users": 200,
                },
            ]
        )
        df = get_metric_df(
            rows, {"zero": 0, "one": 1}, ["zero", "one"], False, "revenue", False
        )
        result = analyze_metric_df(
            df, [0.5, 0.5], "revenue", False, StatsEngine.FREQUENTIST
        )

        self.assertEqual(len(result.index), 2)
        self.assertEqual(result.at[0, "dimension"], "one")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 2.7)
        self.assertEqual(result.at[0, "baseline_risk"], None)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 2.5)
        self.assertEqual(result.at[0, "v1_risk"], None)
        self.assertEqual(round_(result.at[0, "v1_expected"]), -0.074074074)
        self.assertEqual(result.at[0, "v1_prob_beat_baseline"], None)
        self.assertEqual(round_(result.at[0, "v1_p_value"]), 0.145219005)


class TestAdjustedStats(TestCase):
    def test_adjusted_stats(self):
        adjusted = get_adjusted_stats(5, 3, 1000, 2000, False, "revenue")
        print(adjusted)
        self.assertEqual(adjusted["users"], 2000)
        self.assertEqual(adjusted["mean"], 2.5)
        self.assertEqual(round_(adjusted["stddev"]), 3.278852762)
        self.assertEqual(adjusted["total"], 5000)

    def test_adjusted_stats_binomial(self):
        adjusted = get_adjusted_stats(1, 0, 1000, 2000, False, "binomial")
        print(adjusted)
        self.assertEqual(adjusted["users"], 2000)
        self.assertEqual(adjusted["mean"], 0.5)
        self.assertEqual(round_(adjusted["stddev"]), math.sqrt(0.25))
        self.assertEqual(adjusted["total"], 1000)

    def test_adjusted_stats_ignore_nulls(self):
        adjusted = get_adjusted_stats(5, 3, 1000, 2000, True, "revenue")
        self.assertEqual(adjusted["users"], 1000)
        self.assertEqual(adjusted["mean"], 5)
        self.assertEqual(adjusted["stddev"], 3)
        self.assertEqual(adjusted["total"], 5000)


if __name__ == "__main__":
    unittest_main()
