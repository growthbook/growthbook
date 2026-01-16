import dataclasses
from functools import partial
from unittest import TestCase, main as unittest_main
import numpy as np
import pandas as pd
import copy

from gbstats.gbstats import (
    AnalysisSettingsForStatsEngine,
    BanditSettingsForStatsEngine,
    MetricSettingsForStatsEngine,
    detect_unknown_variations,
    reduce_dimensionality,
    analyze_metric_df,
    get_metric_dfs,
    variation_statistic_from_metric_row,
    process_analysis,
    get_bandit_result,
    create_bandit_statistics,
    preprocess_bandits,
)
from gbstats.bayesian.bandits import BanditsSimple

from gbstats.models.settings import BanditWeightsSinglePeriod
from gbstats.models.statistics import (
    RegressionAdjustedStatistic,
    SampleMeanStatistic,
)
from gbstats.models.results import (
    BayesianVariationResponseIndividual,
    FrequentistVariationResponseIndividual,
)

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
        "dimension": "All",
        "bandit_period": 0,
        "variation": "zero",
        "main_sum": 270,
        "main_sum_squares": 848.79,
        "users": 100,
        "count": 100,
    },
    {
        "dimension": "All",
        "bandit_period": 0,
        "variation": "one",
        "main_sum": 300,
        "main_sum_squares": 869,
        "users": 120,
        "count": 120,
    },
    {
        "dimension": "All",
        "bandit_period": 0,
        "variation": "two",
        "main_sum": 740,
        "main_sum_squares": 1615.59,
        "users": 200,
        "count": 200,
    },
    {
        "dimension": "All",
        "bandit_period": 0,
        "variation": "three",
        "main_sum": 770,
        "main_sum_squares": 1571,
        "users": 220,
        "count": 220,
    },
    {
        "dimension": "All",
        "bandit_period": 1,
        "variation": "zero",
        "main_sum": 270,
        "main_sum_squares": 848.79,
        "users": 100,
        "count": 100,
    },
    {
        "dimension": "All",
        "bandit_period": 1,
        "variation": "one",
        "main_sum": 300,
        "main_sum_squares": 869,
        "users": 120,
        "count": 120,
    },
    {
        "dimension": "All",
        "bandit_period": 1,
        "variation": "two",
        "main_sum": 740,
        "main_sum_squares": 1615.59,
        "users": 200,
        "count": 200,
    },
    {
        "dimension": "All",
        "bandit_period": 1,
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

RATIO_RA_METRIC = copy.deepcopy(RATIO_METRIC)
RATIO_RA_METRIC.statistic_type = "ratio_ra"

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

RATIO_RA_STATISTICS_DF = pd.DataFrame(
    [
        {
            "dimension": "All",
            "variation": "zero",
            "users": 100,
            "count": 100,
            "main_sum": 485.112236689623,
            "main_sum_squares": 2715.484666118136,
            "denominator_sum": 679.9093275844917,
            "denominator_sum_squares": 4939.424001640236,
            "covariate_sum": 192.59138069991536,
            "covariate_sum_squares": 460.076026390857,
            "denominator_pre_sum": 290.1398399750233,
            "denominator_pre_sum_squares": 920.9461385038898,
            "main_covariate_sum_product": 1113.6215759318352,
            "main_denominator_sum_product": 3602.146836776702,
            "main_post_denominator_pre_sum_product": 1559.2878434944676,
            "main_pre_denominator_post_sum_product": 1460.3181079276983,
            "main_pre_denominator_pre_sum_product": 634.239482353647,
            "denominator_post_denominator_pre_sum_product": 2130.9404074446747,
            "theta": None,
        },
        {
            "dimension": "All",
            "variation": "one",
            "users": 100,
            "count": 100,
            "main_sum": 514.7757826608777,
            "main_sum_squares": 2994.897482705013,
            "denominator_sum": 705.4090874383759,
            "denominator_sum_squares": 5291.36604146392,
            "covariate_sum": 206.94157227402536,
            "covariate_sum_squares": 514.2903702246757,
            "denominator_pre_sum": 302.54389139107326,
            "denominator_pre_sum_squares": 994.4506208125663,
            "main_covariate_sum_product": 1237.0953021125997,
            "main_denominator_sum_product": 3918.1561431600717,
            "main_post_denominator_pre_sum_product": 1701.0287270040265,
            "main_pre_denominator_post_sum_product": 1604.075950326651,
            "main_pre_denominator_pre_sum_product": 698.4173425817913,
            "denominator_post_denominator_pre_sum_product": 2292.081739775257,
            "theta": None,
        },
    ]
)


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
    one_sided_intervals=False,
)


BANDIT_ANALYSIS = BanditSettingsForStatsEngine(
    var_names=["zero", "one", "two", "three"],
    var_ids=["zero", "one", "two", "three"],
    current_weights=[1 / 4] * 4,
    reweight=True,
    decision_metric="count_metric",
    bandit_weights_seed=int(100),
    weight_by_period=True,
    top_two=True,
)


class TestGetMetricDf(TestCase):
    def test_get_metric_dfs_missing_count(self):
        rows = MULTI_DIMENSION_STATISTICS_DF.drop("count", axis=1)
        dimension_metric_data = get_metric_dfs(
            rows,
            {"zero": 0, "one": 1},
            ["zero", "one"],
        )
        for d in dimension_metric_data:
            for row in d.data.iterrows():
                self.assertEqual(row[1]["baseline_count"], row[1]["baseline_users"])
                self.assertEqual(row[1]["v1_count"], row[1]["v1_users"])


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
                theta=None,
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
        df = get_metric_dfs(
            rows,
            {"zero": 0, "one": 1},
            ["zero", "one"],
        )
        reduced_3 = reduce_dimensionality(df, num_variations=2, max=3)
        reduced_2 = reduce_dimensionality(df, num_variations=2, max=2)

        self.assertEqual(len(reduced_3), 3)
        self.assertEqual(reduced_3[0].data.at[0, "dimension"], "three")
        self.assertEqual(reduced_3[0].data.at[0, "v1_main_sum"], 222)
        self.assertEqual(len(reduced_2), 2)
        self.assertEqual(reduced_2[1].data.at[0, "dimension"], "(other)")
        self.assertEqual(reduced_2[1].data.at[0, "v1_main_sum"], 1070)
        self.assertEqual(reduced_2[1].data.at[0, "v1_main_sum_squares"], 4440)
        self.assertEqual(reduced_2[1].data.at[0, "v1_users"], 340)
        self.assertEqual(reduced_2[1].data.at[0, "baseline_users"], 300)
        self.assertEqual(reduced_2[1].data.at[0, "baseline_main_sum"], 1010)
        self.assertEqual(reduced_2[1].data.at[0, "baseline_main_sum_squares"], 4464.38)

    def test_reduce_dimensionality_ratio(self):
        rows = pd.concat(
            [RATIO_STATISTICS_DF, RATIO_STATISTICS_ADDITIONAL_DIMENSION_DF]
        )
        df = get_metric_dfs(
            rows,
            {"zero": 0, "one": 1},
            ["zero", "one"],
        )

        reduced_20 = reduce_dimensionality(df, num_variations=2, max=20)
        self.assertEqual(len(reduced_20), 2)
        self.assertEqual(reduced_20[0].data.at[0, "dimension"], "one")
        self.assertEqual(reduced_20[0].data.at[0, "v1_users"], 120)
        self.assertEqual(reduced_20[0].data.at[0, "v1_main_sum"], 300)
        self.assertEqual(reduced_20[0].data.at[0, "v1_main_sum_squares"], 869)
        self.assertEqual(reduced_20[0].data.at[0, "v1_denominator_sum"], 500)
        self.assertEqual(reduced_20[0].data.at[0, "v1_denominator_sum_squares"], 800)
        self.assertEqual(
            reduced_20[0].data.at[0, "v1_main_denominator_sum_product"], -905
        )
        self.assertEqual(reduced_20[0].data.at[0, "baseline_users"], 100)
        self.assertEqual(reduced_20[0].data.at[0, "baseline_main_sum"], 270)
        self.assertEqual(reduced_20[0].data.at[0, "baseline_main_sum_squares"], 848.79)
        self.assertEqual(reduced_20[0].data.at[0, "baseline_denominator_sum"], 510)
        self.assertEqual(
            reduced_20[0].data.at[0, "baseline_denominator_sum_squares"], 810
        )
        self.assertEqual(
            reduced_20[0].data.at[0, "baseline_main_denominator_sum_product"], -900
        )

        reduced_1 = reduce_dimensionality(df, num_variations=2, max=1)
        self.assertEqual(len(reduced_1), 1)
        self.assertEqual(reduced_1[0].data.at[0, "dimension"], "(other)")
        self.assertEqual(reduced_1[0].data.at[0, "v1_users"], 120 * 2)
        self.assertEqual(reduced_1[0].data.at[0, "v1_main_sum"], 300 * 2)
        self.assertEqual(reduced_1[0].data.at[0, "v1_main_sum_squares"], 869 * 2)
        self.assertEqual(reduced_1[0].data.at[0, "v1_denominator_sum"], 500 * 2)
        self.assertEqual(reduced_1[0].data.at[0, "v1_denominator_sum_squares"], 800 * 2)
        self.assertEqual(
            reduced_1[0].data.at[0, "v1_main_denominator_sum_product"], -905 * 2
        )
        self.assertEqual(reduced_1[0].data.at[0, "baseline_users"], 100 * 2)
        self.assertEqual(reduced_1[0].data.at[0, "baseline_main_sum"], 270 * 2)
        self.assertEqual(
            reduced_1[0].data.at[0, "baseline_main_sum_squares"], 848.79 * 2
        )
        self.assertEqual(reduced_1[0].data.at[0, "baseline_denominator_sum"], 510 * 2)
        self.assertEqual(
            reduced_1[0].data.at[0, "baseline_denominator_sum_squares"], 810 * 2
        )
        self.assertEqual(
            reduced_1[0].data.at[0, "baseline_main_denominator_sum_product"], -900 * 2
        )


class TestAnalyzeMetricDfBayesian(TestCase):
    # New usage (no mean/stddev correction)
    def test_get_metric_dfs_new(self):
        rows = MULTI_DIMENSION_STATISTICS_DF
        df = get_metric_dfs(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(
            df, num_variations=2, metric=COUNT_METRIC, analysis=DEFAULT_ANALYSIS
        )
        self.assertEqual(len(result), 2)

        self.assertEqual(result[0].dimension, "one")
        self.assertEqual(round_(result[0].variations[0].cr), 2.7)
        self.assertEqual(round_(result[0].variations[1].cr), 2.5)
        if isinstance(result[0].variations[1], BayesianVariationResponseIndividual):
            self.assertEqual(round_(result[0].variations[1].risk[1]), 0.075691131)
            self.assertEqual(round_(result[0].variations[1].expected), -0.074074074)
            self.assertEqual(round_(result[0].variations[1].chanceToWin), 0.071834168)
        else:
            raise TypeError(
                f"Unexpected variation response type: {type(result[0].variations[1])}"
            )

    def test_get_metric_dfs_bayesian_ratio(self):
        rows = RATIO_STATISTICS_DF
        df = get_metric_dfs(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(
            df, num_variations=2, metric=RATIO_METRIC, analysis=DEFAULT_ANALYSIS
        )

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].dimension, "one")
        self.assertEqual(round_(result[0].variations[0].cr), 0.529411765)
        self.assertEqual(round_(result[0].variations[1].cr), 0.6)
        if isinstance(result[0].variations[1], BayesianVariationResponseIndividual):
            self.assertEqual(round_(result[0].variations[1].risk[1]), 0.050934045)
            self.assertEqual(round_(result[0].variations[1].expected), 0.133333333)
            self.assertEqual(round_(result[0].variations[1].chanceToWin), 0.694926359)
        else:
            raise TypeError(
                f"Unexpected variation response type: {type(result[0].variations[1])}"
            )

    def test_get_metric_dfs_inverse(self):
        rows = MULTI_DIMENSION_STATISTICS_DF
        df = get_metric_dfs(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(
            df,
            num_variations=2,
            metric=dataclasses.replace(COUNT_METRIC, inverse=True),
            analysis=DEFAULT_ANALYSIS,
        )

        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].dimension, "one")
        self.assertEqual(round_(result[0].variations[0].cr), 2.7)
        self.assertEqual(round_(result[0].variations[1].cr), 2.5)
        if isinstance(result[0].variations[1], BayesianVariationResponseIndividual):
            self.assertEqual(round_(result[0].variations[1].risk[1]), 0.001617057)
            self.assertEqual(round_(result[0].variations[1].expected), -0.074074074)
            self.assertEqual(
                round_(result[0].variations[1].chanceToWin), 1 - 0.071834168
            )
        else:
            raise TypeError(
                f"Unexpected variation response type: {type(result[0].variations[1])}"
            )

    def test_get_metric_dfs_zero_val(self):
        rows = ONE_USER_DF
        df = get_metric_dfs(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(
            df,
            num_variations=2,
            metric=dataclasses.replace(COUNT_METRIC, inverse=True),
            analysis=DEFAULT_ANALYSIS,
        )

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].dimension, "one")
        self.assertEqual(round_(result[0].variations[0].cr), 6.666666667)
        self.assertEqual(round_(result[0].variations[1].cr), 1)
        if isinstance(result[0].variations[1], BayesianVariationResponseIndividual):
            self.assertEqual(round_(result[0].variations[1].risk[1]), 0)
            self.assertEqual(round_(result[0].variations[1].expected), 0)
            self.assertEqual(round_(result[0].variations[1].chanceToWin), 0.5)
        else:
            raise TypeError(
                f"Unexpected variation response type: {type(result[0].variations[1])}"
            )

    def test_get_metric_dfs_ratio_zero_denom(self):
        rows = ZERO_DENOM_RATIO_STATISTICS_DF
        df = get_metric_dfs(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(
            df, num_variations=2, metric=RATIO_METRIC, analysis=DEFAULT_ANALYSIS
        )
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].dimension, "one")
        self.assertEqual(round_(result[0].variations[0].cr), 0)
        self.assertEqual(round_(result[0].variations[1].cr), 0.6)
        if isinstance(result[0].variations[1], BayesianVariationResponseIndividual):
            self.assertEqual(round_(result[0].variations[1].risk[1]), 0)
            self.assertEqual(round_(result[0].variations[1].expected), 0)
            self.assertEqual(round_(result[0].variations[1].chanceToWin), 0.5)
        else:
            raise TypeError(
                f"Unexpected variation response type: {type(result[0].variations[1])}"
            )


class TestAnalyzeMetricDfFrequentist(TestCase):
    def test_get_metric_dfs_frequentist(self):
        rows = MULTI_DIMENSION_STATISTICS_DF
        df = get_metric_dfs(
            rows,
            {"zero": 0, "one": 1},
            ["zero", "one"],
        )
        result = analyze_metric_df(
            df,
            num_variations=2,
            metric=COUNT_METRIC,
            analysis=dataclasses.replace(DEFAULT_ANALYSIS, stats_engine="frequentist"),
        )

        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].dimension, "one")
        self.assertEqual(round_(result[0].variations[0].cr), 2.7)
        self.assertEqual(round_(result[0].variations[1].cr), 2.5)
        if isinstance(result[0].variations[1], FrequentistVariationResponseIndividual):
            self.assertEqual(round_(result[0].variations[1].expected), -0.074074074)
            if result[0].variations[1].pValue is not None:
                self.assertEqual(round_(result[0].variations[1].pValue), 0.145219005)
            else:
                raise ValueError(
                    f"pValue is None for variation response: {result[0].variations[1]}"
                )
        else:
            raise TypeError(
                f"Unexpected variation response type: {type(result[0].variations[1])}"
            )

    def test_get_metric_dfs_frequentist_ratio(self):
        rows = RATIO_STATISTICS_DF
        df = get_metric_dfs(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(
            df,
            num_variations=2,
            metric=RATIO_METRIC,
            analysis=dataclasses.replace(DEFAULT_ANALYSIS, stats_engine="frequentist"),
        )

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].dimension, "one")
        self.assertEqual(round_(result[0].variations[0].cr), 0.529411765)
        self.assertEqual(round_(result[0].variations[1].cr), 0.6)
        if isinstance(result[0].variations[1], FrequentistVariationResponseIndividual):
            self.assertEqual(round_(result[0].variations[1].expected), 0.133333333)
            if result[0].variations[1].pValue is not None:
                self.assertEqual(round_(result[0].variations[1].pValue), 0.610663339)
            else:
                raise ValueError(
                    f"pValue is None for variation response: {result[0].variations[1]}"
                )
        else:
            raise TypeError(
                f"Unexpected variation response type: {type(result[0].variations[1])}"
            )

    def test_get_metric_dfs_zero_val(self):
        rows = ONE_USER_DF
        df = get_metric_dfs(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(
            df,
            num_variations=2,
            metric=COUNT_METRIC,
            analysis=dataclasses.replace(DEFAULT_ANALYSIS, stats_engine="frequentist"),
        )

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].dimension, "one")
        self.assertEqual(round_(result[0].variations[0].cr), 6.666666667)
        self.assertEqual(round_(result[0].variations[1].cr), 1)
        if isinstance(result[0].variations[1], FrequentistVariationResponseIndividual):
            self.assertEqual(round_(result[0].variations[1].expected), 0)
            if result[0].variations[1].pValue is not None:
                self.assertEqual(round_(result[0].variations[1].pValue), 1)
            else:
                raise ValueError(
                    f"pValue is None for variation response: {result[0].variations[1]}"
                )
        else:
            raise TypeError(
                f"Unexpected variation response type: {type(result[0].variations[1])}"
            )

    def test_get_metric_dfs_ratio_zero_denom(self):
        rows = ZERO_DENOM_RATIO_STATISTICS_DF
        df = get_metric_dfs(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(
            df,
            num_variations=2,
            metric=RATIO_METRIC,
            analysis=dataclasses.replace(DEFAULT_ANALYSIS, stats_engine="frequentist"),
        )

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].dimension, "one")
        self.assertEqual(round_(result[0].variations[0].cr), 0)
        self.assertEqual(round_(result[0].variations[1].cr), 0.6)
        if isinstance(result[0].variations[1], FrequentistVariationResponseIndividual):
            self.assertEqual(round_(result[0].variations[1].expected), 0)
            if result[0].variations[1].pValue is not None:
                self.assertEqual(round_(result[0].variations[1].pValue), 1)
            else:
                raise ValueError(
                    f"pValue is None for variation response: {result[0].variations[1]}"
                )
        else:
            raise TypeError(
                f"Unexpected variation response type: {type(result[0].variations[1])}"
            )
        self.assertEqual(round_(result[0].variations[1].pValue), 1)


class TestAnalyzeMetricDfRegressionAdjustment(TestCase):
    def test_analyze_metric_df_ra(self):
        rows = RA_STATISTICS_DF
        df = get_metric_dfs(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(
            df,
            num_variations=2,
            metric=RA_METRIC,
            analysis=dataclasses.replace(DEFAULT_ANALYSIS, stats_engine="frequentist"),
        )

        # Test that meric mean is unadjusted
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].dimension, "All")
        self.assertEqual(round_(result[0].variations[0].cr), 0.099966678)
        self.assertEqual(round_(result[0].variations[0].stats.mean), 0.099966678)
        self.assertEqual(round_(result[0].variations[1].cr), 0.074)
        self.assertEqual(round_(result[0].variations[1].stats.mean), 0.074)
        if isinstance(result[0].variations[1], FrequentistVariationResponseIndividual):
            self.assertEqual(round_(result[0].variations[1].expected), -0.281707154)
            if result[0].variations[1].pValue is not None:
                self.assertEqual(round_(result[0].variations[1].pValue), 0.003732549)
            else:
                raise ValueError(
                    f"pValue is None for variation response: {result[0].variations[1]}"
                )
        else:
            raise TypeError(
                f"Unexpected variation response type: {type(result[0].variations[1])}"
            )
        # But difference is not just DIM / control mean, like it used to be
        self.assertNotEqual(
            np.round(result[0].variations[1].expected, 3),
            (0.074 - 0.110963012) / 0.110963012,
        )

    def test_analyze_metric_df_ra_proportion(self):
        rows = RA_STATISTICS_DF.copy()
        # override default DF
        rows.drop(columns=["main_sum_squares", "covariate_sum_squares"], inplace=True)
        df = get_metric_dfs(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(
            df,
            num_variations=2,
            metric=dataclasses.replace(
                RA_METRIC,
                main_metric_type="binomial",
                covariate_metric_type="binomial",
            ),
            analysis=dataclasses.replace(DEFAULT_ANALYSIS, stats_engine="frequentist"),
        )

        # Test that metric mean is unadjusted
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].dimension, "All")
        self.assertEqual(round_(result[0].variations[0].cr), 0.099966678)
        self.assertEqual(round_(result[0].variations[0].stats.mean), 0.099966678)
        self.assertEqual(round_(result[0].variations[1].cr), 0.074)
        self.assertEqual(round_(result[0].variations[1].stats.mean), 0.074)
        if isinstance(result[0].variations[1], FrequentistVariationResponseIndividual):
            self.assertEqual(round_(result[0].variations[1].expected), -0.31620216)
            if result[0].variations[1].pValue is not None:
                self.assertEqual(round_(result[0].variations[1].pValue), 0.000000353)
            else:
                raise ValueError(
                    f"pValue is None for variation response: {result[0].variations[1]}"
                )
        else:
            raise TypeError(
                f"Unexpected variation response type: {type(result[0].variations[1])}"
            )
        self.assertEqual(round_(result[0].variations[1].pValue), 0.000000353)

    def test_analyze_metric_df_ratio_ra(self):
        rows = RATIO_RA_STATISTICS_DF
        df = get_metric_dfs(rows, {"zero": 0, "one": 1}, ["zero", "one"])
        result = analyze_metric_df(
            df,
            num_variations=2,
            metric=RATIO_RA_METRIC,
            analysis=dataclasses.replace(DEFAULT_ANALYSIS, stats_engine="frequentist"),
        )
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].dimension, "All")
        self.assertEqual(round_(result[0].variations[0].cr), 0.713495487)
        self.assertEqual(round_(result[0].variations[0].stats.mean), 0.713495487)
        self.assertEqual(round_(result[0].variations[1].cr), 0.729754963)
        self.assertEqual(round_(result[0].variations[1].stats.mean), 0.729754963)
        if isinstance(result[0].variations[1], FrequentistVariationResponseIndividual):
            self.assertEqual(round_(result[0].variations[1].expected), -0.000701483)
            if result[0].variations[1].pValue is not None:
                self.assertEqual(round_(result[0].variations[1].pValue), 0.857710405)
            else:
                raise ValueError(
                    f"pValue is None for variation response: {result[0].variations[1]}"
                )
        else:
            raise TypeError(
                f"Unexpected variation response type: {type(result[0].variations[1])}"
            )


class TestAnalyzeMetricDfSequential(TestCase):
    def test_analyze_metric_df_sequential(self):
        rows = MULTI_DIMENSION_STATISTICS_DF
        df = get_metric_dfs(
            rows,
            {"zero": 0, "one": 1},
            ["zero", "one"],
        )
        result = analyze_metric_df(
            df,
            num_variations=2,
            metric=COUNT_METRIC,
            analysis=dataclasses.replace(
                DEFAULT_ANALYSIS,
                stats_engine="frequentist",
                sequential_testing_enabled=True,
                sequential_tuning_parameter=600,
            ),
        )

        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].dimension, "one")
        self.assertEqual(round_(result[0].variations[0].cr), 2.7)
        self.assertEqual(round_(result[0].variations[1].cr), 2.5)
        if isinstance(result[0].variations[1], FrequentistVariationResponseIndividual):
            self.assertEqual(round_(result[0].variations[1].expected), -0.074074074)
            if result[0].variations[1].pValue is not None:
                self.assertEqual(round_(result[0].variations[1].pValue), 0.892332229)
            else:
                raise ValueError(
                    f"pValue is None for variation response: {result[0].variations[1]}"
                )
            if result[0].variations[1].ci[0] is not None:
                self.assertEqual(round_(result[0].variations[1].ci[0]), -0.233322085)
            else:
                raise ValueError(
                    f"ci[0] is None for variation response: {result[0].variations[1]}"
                )
        else:
            raise TypeError(
                f"Unexpected variation response type: {type(result[0].variations[1])}"
            )

        result_bad_tuning = analyze_metric_df(
            df,
            num_variations=2,
            metric=COUNT_METRIC,
            analysis=dataclasses.replace(
                DEFAULT_ANALYSIS,
                stats_engine="frequentist",
                sequential_testing_enabled=True,
                sequential_tuning_parameter=1,
            ),
        )

        # Wider CI with lower tuning parameter to test it passes through
        if (
            isinstance(result[0].variations[1].ci[0], float)
            and isinstance(
                result[0].variations[1], FrequentistVariationResponseIndividual
            )
            and isinstance(
                result_bad_tuning[0].variations[1],
                FrequentistVariationResponseIndividual,
            )
            and isinstance(result_bad_tuning[0].variations[1].ci[0], float)
            and isinstance(
                result_bad_tuning[0].variations[1],
                FrequentistVariationResponseIndividual,
            )
        ):
            self.assertTrue(
                result[0].variations[1].ci[0] > result_bad_tuning[0].variations[1].ci[0]
            )
        else:
            raise TypeError(
                f"Unexpected variation response type: {type(result[0].variations[1])}"
            )


class TestProcessAnalysis(TestCase):
    def test_process_analysis_denominator(self):
        rows = RATIO_STATISTICS_DF
        result = process_analysis(
            rows,
            var_id_map={"zero": 0, "one": 1},
            metric=COUNT_METRIC,
            analysis=DEFAULT_ANALYSIS,
        )
        for res in result:
            for i, v in enumerate(res.variations):
                self.assertEqual(v.denominator, 510 if i == 0 else 500)


if __name__ == "__main__":
    unittest_main()
