from dataclasses import asdict
from functools import partial
from unittest import TestCase, main as unittest_main

import numpy as np
from scipy.stats import norm
import copy

from gbstats.frequentist.tests import FrequentistConfig, TwoSidedTTest
from gbstats.models.settings import (
    MetricSettingsForStatsEngine,
    AnalysisSettingsForStatsEngine,
)

from gbstats.devtools.simulation import CreateStatistic, CreateRow
from gbstats.gbstats import process_single_metric


class TestCreateRows(TestCase):
    def setUp(self):
        metric_settings_1 = MetricSettingsForStatsEngine(
            id="count_metric_1",
            name="count_metric_1",
            inverse=False,
            statistic_type="mean",
            main_metric_type="count",
            business_metric_type=["goal"],
        )
        metric_settings_2 = copy.deepcopy(metric_settings_1)
        metric_settings_2.statistic_type = "ratio_ra"
        metric_settings_2.id = "ratio_ra_metric_1"
        metric_settings_2.name = "ratio_ra_metric_1"
        metric_settings_2.denominator_metric_type = "count"

        self.analysis_settings_abs = AnalysisSettingsForStatsEngine(
            var_names=["zero", "one"],
            var_ids=["zero", "one"],
            weights=[0.5, 0.5],
            baseline_index=0,
            dimension="",
            stats_engine="frequentist",
            sequential_testing_enabled=False,
            sequential_tuning_parameter=5000,
            difference_type="absolute",
            phase_length_days=7,
            # phase_length_days=41,
        )

        rng_a_1 = np.random.default_rng(seed=int(20241213))
        rng_b_1 = np.random.default_rng(seed=int(20241214))
        rng_a_2 = np.random.default_rng(seed=int(20241215))
        rng_b_2 = np.random.default_rng(seed=int(20241216))

        mu_a = 1
        n_0 = 599
        n_1 = 500

        delta_abs = 0.15

        y_a_1 = np.sqrt(1) * rng_a_1.normal(size=n_0) + mu_a
        y_b_1 = np.sqrt(1) * rng_b_1.normal(size=n_1) + mu_a + delta_abs
        y_a_2 = np.sqrt(1) * rng_a_2.normal(size=n_0) + mu_a
        y_b_2 = np.sqrt(1) * rng_b_2.normal(size=n_1) + mu_a + delta_abs

        x_a_1 = np.sqrt(1) * rng_a_1.normal(size=n_0)
        x_b_1 = np.sqrt(1) * rng_b_1.normal(size=n_1)
        x_a_2 = np.sqrt(1) * rng_a_2.normal(size=n_0)
        x_b_2 = np.sqrt(1) * rng_b_2.normal(size=n_1)

        stat_a_1 = CreateStatistic(
            "sample_mean", y_a_1, x=None, nu=None
        ).create_statistic()
        stat_b_1 = CreateStatistic(
            "sample_mean", y_b_1, x=None, nu=None
        ).create_statistic()
        stat_a_2 = CreateStatistic(
            "sample_mean", y_a_2, x=None, nu=None
        ).create_statistic()
        stat_b_2 = CreateStatistic(
            "sample_mean", y_b_2, x=None, nu=None
        ).create_statistic()

        stat_a_3 = CreateStatistic(
            "regression_adjusted_ratio", np.c_[y_a_1, y_a_2], np.c_[x_a_1, x_a_2], None
        ).create_statistic()
        stat_b_3 = CreateStatistic(
            "regression_adjusted_ratio", np.c_[y_b_1, y_b_2], np.c_[x_b_1, x_b_2], None
        ).create_statistic()

        row_a_1 = CreateRow(
            stat_a_1,
            dimension_name="dimension",
            dimension_value=self.analysis_settings_abs.dimension,
            variation=self.analysis_settings_abs.var_names[0],
        ).create_row()
        row_b_1 = CreateRow(
            stat_b_1,
            dimension_name="dimension",
            dimension_value=self.analysis_settings_abs.dimension,
            variation=self.analysis_settings_abs.var_names[1],
        ).create_row()
        row_a_2 = CreateRow(
            stat_a_2,
            dimension_name="dimension",
            dimension_value=self.analysis_settings_abs.dimension,
            variation=self.analysis_settings_abs.var_names[0],
        ).create_row()
        row_b_2 = CreateRow(
            stat_b_2,
            dimension_name="dimension",
            dimension_value=self.analysis_settings_abs.dimension,
            variation=self.analysis_settings_abs.var_names[1],
        ).create_row()
        row_a_3 = CreateRow(
            stat_a_3,
            dimension_name="dimension",
            dimension_value=self.analysis_settings_abs.dimension,
            variation=self.analysis_settings_abs.var_names[0],
        ).create_row()
        row_b_3 = CreateRow(
            stat_b_3,
            dimension_name="dimension",
            dimension_value=self.analysis_settings_abs.dimension,
            variation=self.analysis_settings_abs.var_names[1],
        ).create_row()

        query_output_1 = [row_a_1, row_b_1]
        query_output_2 = [row_a_2, row_b_2]
        query_output_3 = [row_a_3, row_b_3]

        difference_type = "absolute"

        config = FrequentistConfig(difference_type=difference_type)

        self.res_1 = TwoSidedTTest([(stat_a_1, stat_b_1)], config).compute_result()
        self.res_2 = TwoSidedTTest([(stat_a_2, stat_b_2)], config).compute_result()
        self.res_3 = TwoSidedTTest([(stat_a_3, stat_b_3)], config).compute_result()

        query_output = [query_output_1, query_output_3]
        metric_settings = [metric_settings_1, metric_settings_2]
        analyses = [self.analysis_settings_abs] * 1

        self.results_gbstats = []
        for metric_iter, this_metric in enumerate(metric_settings):
            a = process_single_metric(
                rows=query_output[metric_iter],
                metric=this_metric,
                analyses=analyses,
            )
            self.results_gbstats.append(a)

    def test_count_metric(self):
        self.assertEqual(
            self.results_gbstats[0].analyses[0].dimensions[0].variations[1].ci,
            self.res_1.ci,
        )

    def test_ratio_adjusted_regression_metric(self):
        self.assertEqual(
            self.results_gbstats[1].analyses[0].dimensions[0].variations[1].ci,
            self.res_3.ci,
        )
