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

from gbstats.models.settings import (
    ContextualBanditSettingsForStatsEngine,
    ContextualTreeBanditSettingsForStatsEngine,
)

from gbstats.bayesian.contextual import (
    RowsByContextWithData,
    UpdateWeightsContextualBandit,
    UpdateWeightsContextualTree,
)

from gbstats.models.settings import BanditWeightsSinglePeriod
from gbstats.models.statistics import (
    ProportionStatistic,
    RegressionAdjustedStatistic,
    SampleMeanStatistic,
)
from gbstats.models.results import (
    BaselineResponse,
    BayesianVariationResponseIndividual,
    FrequentistVariationResponseIndividual,
    MetricStats,
    FrequentistVariationResponse,
)

DECIMALS = 9
round_ = partial(np.round, decimals=DECIMALS)

ROWS = [
    {
        "dim_exp_device_platform": "desktop_1",
        "dim_exp_page": "/",
        "dimension": "All",
        "bandit_period": 6,
        "variation": 0,
        "users": 10721,
        "count": 10721,
        "main_sum": np.array([992.72345482]),
        "main_sum_squares": np.array([107656.53801812]),
    },
    {
        "dim_exp_device_platform": "desktop_1",
        "dim_exp_page": "/",
        "dimension": "All",
        "bandit_period": 6,
        "variation": 1,
        "users": 3806,
        "count": 3806,
        "main_sum": np.array([123.32975698]),
        "main_sum_squares": np.array([38190.01707381]),
    },
    {
        "dim_exp_device_platform": "desktop_1",
        "dim_exp_page": "/",
        "dimension": "All",
        "bandit_period": 6,
        "variation": 2,
        "users": 10450,
        "count": 10450,
        "main_sum": np.array([894.91761311]),
        "main_sum_squares": np.array([104918.72776945]),
    },
    {
        "dim_exp_device_platform": "desktop_1",
        "dim_exp_page": "/",
        "dimension": "All",
        "bandit_period": 6,
        "variation": 3,
        "users": 20442,
        "count": 20442,
        "main_sum": np.array([2190.44822945]),
        "main_sum_squares": np.array([205484.9574463]),
    },
    {
        "dim_exp_device_platform": "desktop_1",
        "dim_exp_page": "/",
        "dimension": "All",
        "bandit_period": 6,
        "variation": 4,
        "users": 10875,
        "count": 10875,
        "main_sum": np.array([1265.10625874]),
        "main_sum_squares": np.array([109256.33230243]),
    },
    {
        "dim_exp_device_platform": "desktop_1",
        "dim_exp_page": "/bag-pricing",
        "dimension": "All",
        "bandit_period": 6,
        "variation": 0,
        "users": 2470,
        "count": 2470,
        "main_sum": np.array([-5.94802023]),
        "main_sum_squares": np.array([20847.63623574]),
    },
    {
        "dim_exp_device_platform": "desktop_1",
        "dim_exp_page": "/bag-pricing",
        "dimension": "All",
        "bandit_period": 6,
        "variation": 1,
        "users": 11267,
        "count": 11267,
        "main_sum": np.array([953.28398381]),
        "main_sum_squares": np.array([95284.05904029]),
    },
    {
        "dim_exp_device_platform": "desktop_1",
        "dim_exp_page": "/bag-pricing",
        "dimension": "All",
        "bandit_period": 6,
        "variation": 2,
        "users": 5262,
        "count": 5262,
        "main_sum": np.array([309.92683388]),
        "main_sum_squares": np.array([44521.12456723]),
    },
    {
        "dim_exp_device_platform": "desktop_1",
        "dim_exp_page": "/bag-pricing",
        "dimension": "All",
        "bandit_period": 6,
        "variation": 3,
        "users": 5131,
        "count": 5131,
        "main_sum": np.array([356.81340574]),
        "main_sum_squares": np.array([43427.74476819]),
    },
    {
        "dim_exp_device_platform": "desktop_1",
        "dim_exp_page": "/bag-pricing",
        "dimension": "All",
        "bandit_period": 6,
        "variation": 4,
        "users": 5011,
        "count": 5011,
        "main_sum": np.array([174.20409612]),
        "main_sum_squares": np.array([42312.63427098]),
    },
    {
        "dim_exp_device_platform": "desktop_1",
        "dim_exp_page": "/booking/availability",
        "dimension": "All",
        "bandit_period": 6,
        "variation": 0,
        "users": 156796,
        "count": 156796,
        "main_sum": np.array([23574.52068717]),
        "main_sum_squares": np.array([1956365.47093444]),
    },
    {
        "dim_exp_device_platform": "desktop_1",
        "dim_exp_page": "/booking/availability",
        "dimension": "All",
        "bandit_period": 6,
        "variation": 1,
        "users": 126305,
        "count": 126305,
        "main_sum": np.array([19119.81777565]),
        "main_sum_squares": np.array([1576014.81111452]),
    },
    {
        "dim_exp_device_platform": "desktop_1",
        "dim_exp_page": "/booking/availability",
        "dimension": "All",
        "bandit_period": 6,
        "variation": 2,
        "users": 26933,
        "count": 26933,
        "main_sum": np.array([3130.91199781]),
        "main_sum_squares": np.array([335759.37212]),
    },
    {
        "dim_exp_device_platform": "desktop_1",
        "dim_exp_page": "/booking/availability",
        "dimension": "All",
        "bandit_period": 6,
        "variation": 3,
        "users": 132525,
        "count": 132525,
        "main_sum": np.array([20621.75079475]),
        "main_sum_squares": np.array([1653703.61082615]),
    },
    {
        "dim_exp_device_platform": "desktop_1",
        "dim_exp_page": "/booking/availability",
        "dimension": "All",
        "bandit_period": 6,
        "variation": 4,
        "users": 104365,
        "count": 104365,
        "main_sum": np.array([15527.7639543]),
        "main_sum_squares": np.array([1302156.40917917]),
    },
]

METRIC_SETTINGS = MetricSettingsForStatsEngine(
    id="count_metric",
    name="count_metric",
    statistic_type="mean",
    main_metric_type="count",
    inverse=False,
    prior_proper=False,
    prior_mean=0,
    prior_stddev=0.1,
    keep_theta=False,
    denominator_metric_type=None,
    covariate_metric_type=None,
    quantile_value=None,
    business_metric_type=None,
    target_mde=0.01,
    compute_uncapped_metric=False,
)

ANALYSIS_SETTINGS = AnalysisSettingsForStatsEngine(
    var_names=["zero", "one", "two", "three", "four"],
    var_ids=["0", "1", "2", "3", "4"],
    weights=[0.2, 0.2, 0.2, 0.2, 0.2],
    baseline_index=0,
    dimension="All",
    stats_engine="bayesian",
    p_value_corrected=False,
    sequential_testing_enabled=False,
    sequential_tuning_parameter=5000.0,
    difference_type="absolute",
    phase_length_days=1.0,
    alpha=0.05,
    max_dimensions=20,
    traffic_percentage=1,
    num_goal_metrics=1,
    one_sided_intervals=False,
    post_stratification_enabled=False,
)


class TestContextualBandit(TestCase):
    def test_contextual_bandit(self):
        self.rows = ROWS.copy()
        self.seed = 20260320
        rng_individual_bandit = np.random.default_rng(self.seed)
        rng_contextual_bandit = np.random.default_rng(self.seed)

        self.contexts = [
            ("desktop_1", "/"),
            ("desktop_1", "/bag-pricing"),
            ("desktop_1", "/booking/availability"),
        ]
        bandit_settings = BanditSettingsForStatsEngine(
            var_names=["zero", "one", "two", "three", "four"],
            var_ids=["0", "1", "2", "3", "4"],
            current_weights=[0.2, 0.2, 0.2, 0.2, 0.2],
            reweight=True,
            decision_metric="count_metric",
            bandit_weights_rng=rng_individual_bandit,
            weight_by_period=True,
            top_two=False,
        )
        contextual_bandit_settings = ContextualBanditSettingsForStatsEngine(
            var_names=["zero", "one", "two", "three", "four"],
            var_ids=["0", "1", "2", "3", "4"],
            current_weights=[0.2, 0.2, 0.2, 0.2, 0.2],
            reweight=True,
            decision_metric="count_metric",
            bandit_weights_rng=rng_contextual_bandit,
            weight_by_period=True,
            top_two=False,
            attributes=["dim_exp_device_platform", "dim_exp_page"],
        )
        metric_settings = METRIC_SETTINGS
        analysis_settings = ANALYSIS_SETTINGS

        # update using contextual bandit
        u = UpdateWeightsContextualBandit(
            self.rows, metric_settings, analysis_settings, contextual_bandit_settings
        )
        result_contextual = u.compute_result()
        result_individual = {}
        for context in self.contexts:
            rows_this_context = [
                row
                for row in self.rows
                if row["dim_exp_device_platform"] == context[0]
                and row["dim_exp_page"] == context[1]
            ]
            # update using individual bandits
            r_bandit = get_bandit_result(
                rows_this_context, metric_settings, analysis_settings, bandit_settings
            )
            result_individual[context] = r_bandit
            self.assertEqual(
                result_contextual.responses[context].bestArmProbabilities,
                r_bandit.bestArmProbabilities,
            )


class TestSummableStatisticsPerVariation(TestCase):
    def test_two_arms_mean_count_order_matches_var_ids(self):

        bandit_settings = ContextualTreeBanditSettingsForStatsEngine(
            var_names=["control", "treatment"],
            var_ids=["control", "treatment"],
            current_weights=[0.5, 0.5],
            reweight=True,
            decision_metric="count_metric",
            bandit_weights_rng=np.random.default_rng(100),
            attributes=["dim"],
        )

        var_id_map = {"control": 0, "treatment": 1}
        rows = [
            {
                "dim": "all",
                "variation": "control",
                "users": 100,
                "count": 100,
                "main_sum": 1000.0,
                "main_sum_squares": 12000.0,
            },
            {
                "dim": "all",
                "variation": "treatment",
                "users": 50,
                "count": 50,
                "main_sum": 600.0,
                "main_sum_squares": 8000.0,
            },
        ]
        self.partition = RowsByContextWithData.from_experiment_rows(
            rows,
            bandit_settings,
        )

        stats_df = UpdateWeightsContextualTree.summable_statistics_per_variation_from_experiment_metric_rows(
            self.partition, METRIC_SETTINGS, bandit_settings, var_id_map
        )
        self.assertIsInstance(stats_df["control"].iloc[0], SampleMeanStatistic)
        self.assertIsInstance(stats_df["treatment"].iloc[0], SampleMeanStatistic)
        self.assertEqual(stats_df["control"].iloc[0].mean, 10.0)
        self.assertEqual(stats_df["treatment"].iloc[0].mean, 12.0)

    def test_missing_arm_zero_sample_mean(self):
        bandit_settings = ContextualTreeBanditSettingsForStatsEngine(
            var_names=["a", "b", "c"],
            var_ids=["a", "b", "c"],
            current_weights=[1 / 3, 1 / 3, 1 / 3],
            reweight=True,
            decision_metric="m",
            bandit_weights_rng=np.random.default_rng(0),
            attributes=["dim"],
        )
        var_id_map = {"a": 0, "b": 1, "c": 2}
        rows = [
            {
                "dim": "x",
                "variation": "a",
                "users": 10,
                "count": 10,
                "main_sum": 5.0,
                "main_sum_squares": 25.0,
            },
        ]
        partition = RowsByContextWithData.from_experiment_rows(rows, bandit_settings)
        stats_df = UpdateWeightsContextualTree.summable_statistics_per_variation_from_experiment_metric_rows(
            partition, METRIC_SETTINGS, bandit_settings, var_id_map
        )
        self.assertEqual(stats_df["a"].iloc[0].mean, 0.5)
        self.assertEqual(stats_df["b"].iloc[0].n, 0)
        self.assertEqual(stats_df["b"].iloc[0].mean, 0.0)
        self.assertEqual(stats_df["c"].iloc[0].n, 0)

    def test_merge_duplicate_variation_rows(self):
        bandit_settings = ContextualTreeBanditSettingsForStatsEngine(
            var_names=["v0"],
            var_ids=["v0"],
            current_weights=[1.0],
            reweight=True,
            decision_metric="m",
            bandit_weights_rng=np.random.default_rng(0),
            attributes=["dim"],
        )
        var_id_map = {"v0": 0}
        rows = [
            {
                "dim": "x",
                "variation": "v0",
                "users": 10,
                "count": 10,
                "main_sum": 100.0,
                "main_sum_squares": 1000.0,
            },
            {
                "dim": "x",
                "variation": "v0",
                "users": 20,
                "count": 20,
                "main_sum": 200.0,
                "main_sum_squares": 2200.0,
            },
        ]
        partition = RowsByContextWithData.from_experiment_rows(rows, bandit_settings)
        stats_df = UpdateWeightsContextualTree.summable_statistics_per_variation_from_experiment_metric_rows(
            partition, METRIC_SETTINGS, bandit_settings, var_id_map
        )
        merged = stats_df["v0"].iloc[0]
        self.assertEqual(merged.n, 30)
        self.assertEqual(merged.sum, 300.0)

    def test_quantile_metric_raises(self):
        q_metric = MetricSettingsForStatsEngine(
            id="q",
            name="q",
            inverse=False,
            statistic_type="quantile_unit",
            main_metric_type="count",
            quantile_value=0.5,
        )
        bandit_settings = ContextualTreeBanditSettingsForStatsEngine(
            var_names=["a"],
            var_ids=["a"],
            current_weights=[1.0],
            reweight=True,
            decision_metric="m",
            bandit_weights_rng=np.random.default_rng(0),
            attributes=["dim"],
        )
        var_id_map = {"a": 0}
        partition = RowsByContextWithData(
            rows_with_data={
                ("x",): [
                    {
                        "dim": "x",
                        "variation": "a",
                        "users": 10,
                        "count": 10,
                        "main_sum": 1.0,
                        "main_sum_squares": 1.0,
                        "quantile_n": 10,
                        "quantile_nstar": 10,
                        "quantile": 0.5,
                        "quantile_lower": 0.4,
                        "quantile_upper": 0.6,
                    },
                ],
            },
            unique_keys=[("x",)],
        )
        with self.assertRaises(TypeError):
            UpdateWeightsContextualTree.summable_statistics_per_variation_from_experiment_metric_rows(
                partition, q_metric, bandit_settings, var_id_map
            )

    def test_binomial_arm_returns_proportion_statistic(self):
        binomial_metric = MetricSettingsForStatsEngine(
            id="b",
            name="b",
            inverse=False,
            statistic_type="mean",
            main_metric_type="binomial",
        )
        bandit_settings = ContextualTreeBanditSettingsForStatsEngine(
            var_names=["0", "1"],
            var_ids=["0", "1"],
            current_weights=[0.5, 0.5],
            reweight=True,
            decision_metric="b",
            bandit_weights_rng=np.random.default_rng(0),
            attributes=["dim"],
        )
        var_id_map = {"0": 0, "1": 1}
        rows = [
            {
                "dim": "all",
                "variation": 0,
                "users": 100,
                "count": 100,
                "main_sum": 30.0,
                "main_sum_squares": 30.0,
            },
        ]
        partition = RowsByContextWithData.from_experiment_rows(rows, bandit_settings)
        stats_df = UpdateWeightsContextualTree.summable_statistics_per_variation_from_experiment_metric_rows(
            partition, binomial_metric, bandit_settings, var_id_map
        )
        stat_0 = stats_df["0"].iloc[0]
        stat_1 = stats_df["1"].iloc[0]
        self.assertIsInstance(stat_0, ProportionStatistic)
        self.assertEqual(stat_0.mean, 0.3)
        self.assertIsInstance(stat_1, ProportionStatistic)
