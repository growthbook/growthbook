import math
from functools import partial
from unittest import TestCase, main as unittest_main

import numpy as np
import pandas as pd

from gbstats.gbstats import (
    check_srm,
    get_adjusted_stats,
    process_user_rows,
    process_metric_rows,
    run_analysis,
    correctMean,
    correctStddev,
    detect_unknown_variations,
    reduce_dimensionality,
    analyze_metric_df,
    get_metric_df,
)

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
        self.assertEqual(detect_unknown_variations(rows, {"zero": 0, "hello": 1}), {"one"})
        self.assertEqual(detect_unknown_variations(rows, {"hello": 0, "world": 1}), {"one", "zero"})


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
        self.assertEqual(detect_unknown_variations(rows, {"one": 0, "two": 1}, {"some_other"}), {
            "__multiple__"
        })

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
        df = get_metric_df(rows, {"zero": 0, "one": 1}, ["zero", "one"], True, "revenue")
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


class TestAnalyzeMetricDf(TestCase):
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
        df = get_metric_df(rows, {"zero": 0, "one": 1}, ["zero", "one"], False, "revenue")
        result = analyze_metric_df(df, [0.5, 0.5], "revenue", False)

        self.assertEqual(len(result.index), 2)
        self.assertEqual(result.at[0, "dimension"], "one")
        self.assertEqual(round_(result.at[0, "baseline_cr"]), 0.245454545)
        self.assertEqual(round_(result.at[0, "baseline_risk"]), 0.186006962)
        self.assertEqual(round_(result.at[0, "v1_cr"]), 0.3)
        self.assertEqual(round_(result.at[0, "v1_risk"]), 0.00418878)
        self.assertEqual(round_(result.at[0, "v1_expected"]), 0.222222222)
        self.assertEqual(round_(result.at[0, "v1_prob_beat_baseline"]), 0.925127213)

class TestAdjustedStates(TestCase):
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


class TestProcessRows(TestCase):
    def test_process_users(self):
        vars = {"zero": 0, "one": 1}
        rows = pd.DataFrame(
            [{"variation": "one", "users": 120}, {"variation": "zero", "users": 100}]
        )
        users, unknown_variations = process_user_rows(rows, vars)

        self.assertEqual(users, [100, 120])
        self.assertEqual(unknown_variations, [])


    def test_process_users_unknown_vars(self):
        var_id_map = {"zero": 0, "one": 1}
        rows = pd.DataFrame(
            [{"variation": "one", "users": 120}, {"variation": "zeros", "users": 100}]
        )
        users, unknown_variations = process_user_rows(rows, var_id_map)

        self.assertEqual(users, [0, 120])
        self.assertEqual(unknown_variations, ["zeros"])


    def test_process_metrics(self):
        rows = pd.DataFrame(
            [
                {"variation": "one", "count": 120, "mean": 2.5, "stddev": 1},
                {"variation": "zero", "count": 100, "mean": 2.7, "stddev": 1.1},
            ]
        )
        var_id_map = {"zero": 0, "one": 1}
        users = [1000, 1010]

        res = process_metric_rows(rows, var_id_map, users, False, "revenue")
        self.assertEqual(res.loc[0].at["users"], 1000)
        self.assertEqual(res.loc[0].at["count"], 1000)
        self.assertEqual(res.loc[0].at["mean"], 0.27)
        self.assertEqual(round_(res.loc[0].at["stddev"]), 0.881286938)


    def test_process_metrics_ignore_nulls(self):
        rows = pd.DataFrame(
            [
                {"variation": "one", "count": 120, "mean": 2.5, "stddev": 1},
                {"variation": "zero", "count": 100, "mean": 2.7, "stddev": 1.1},
            ]
        )
        var_id_map = {"zero": 0, "one": 1}
        users = [1000, 1010]

        res = process_metric_rows(rows, var_id_map, users, True, "revenue")
        self.assertEqual(res.loc[0].at["users"], 100)
        self.assertEqual(res.loc[0].at["count"], 100)
        self.assertEqual(res.loc[0].at["mean"], 2.7)
        self.assertEqual(round_(res.loc[0].at["stddev"]), 1.1)

class TestBinomialAnalysis(TestCase):
    def test_binomial_analysis(self):
        metric = pd.DataFrame(
            [
                {"users": 1000, "count": 120, "mean": 1, "stddev": 0, "total": 120},
                {"users": 1024, "count": 128, "mean": 1, "stddev": 0, "total": 128},
                {"users": 1000, "count": 102, "mean": 1, "stddev": 0, "total": 102},
            ]
        )
        var_names = ["Control", "Variation 1", "Variation 2"]
        res = run_analysis(metric, var_names, "binomial", False)

        baseline = res.loc[0]
        var1 = res.loc[1]
        var2 = res.loc[2]

        self.assertEqual(baseline.at["variation"], "Control")
        self.assertEqual(baseline.at["conversion_rate"], 0.12)
        self.assertEqual(baseline.at["chance_to_beat_control"], None)
        self.assertEqual(round_(baseline.at["risk_of_choosing"]), 0.069118343)
        self.assertEqual(baseline.at["percent_change"], None)

        self.assertEqual(var1.at["variation"], "Variation 1")
        self.assertEqual(var1.at["conversion_rate"], 0.125)
        self.assertEqual(round_(var1.at["chance_to_beat_control"]), 0.633751254)
        self.assertEqual(round_(var1.at["risk_of_choosing"]), 0.029338254)
        self.assertEqual(round_(var1.at["percent_change"]), 0.041432724)

        self.assertEqual(var2.at["variation"], "Variation 2")
        self.assertEqual(var2.at["conversion_rate"], 0.102)
        self.assertEqual(round_(var2.at["chance_to_beat_control"]), 0.100849049)
        self.assertEqual(round_(var2.at["risk_of_choosing"]), 0.182688464)
        self.assertEqual(round_(var2.at["percent_change"]), -0.149376661)

class TestGaussianAnalysis(TestCase):
    def test_gaussian_analysis(self):
        metric = pd.DataFrame(
            [
                {"users": 1000, "count": 120, "mean": 1.3, "stddev": 1, "total": 156},
                {"users": 1024, "count": 128, "mean": 1.29, "stddev": 0.9, "total": 165.12},
                {"users": 1000, "count": 102, "mean": 1.4, "stddev": 1.1, "total": 142.8},
            ]
        )
        var_names = ["Control", "Variation 1", "Variation 2"]
        res = run_analysis(metric, var_names, "duration", True)

        baseline = res.loc[0]
        var1 = res.loc[1]
        var2 = res.loc[2]

        self.assertEqual(baseline.at["variation"], "Control")
        self.assertEqual(baseline.at["per_user"], 0.156)
        self.assertEqual(baseline.at["chance_to_beat_control"], None)
        self.assertEqual(round_(baseline.at["risk_of_choosing"]), 0.138620458)
        self.assertEqual(baseline.at["percent_change"], None)

        self.assertEqual(var1.at["variation"], "Variation 1")
        self.assertEqual(var1.at["per_user"], 0.16125)
        self.assertEqual(round_(var1.at["chance_to_beat_control"]), 0.593436958)
        self.assertEqual(round_(var1.at["risk_of_choosing"]), 0.076604954)
        self.assertEqual(round_(var1.at["percent_change"]), -0.007692308)

        self.assertEqual(var2.at["variation"], "Variation 2")
        self.assertEqual(round_(var2.at["per_user"]), 0.1428)
        self.assertEqual(round_(var2.at["chance_to_beat_control"]), 0.016533047)
        self.assertEqual(round_(var2.at["risk_of_choosing"]), 0.702254931)
        self.assertEqual(round_(var2.at["percent_change"]), 0.076923077)

if __name__ == "__main__":
    unittest_main()
