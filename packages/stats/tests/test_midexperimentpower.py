from dataclasses import asdict
from functools import partial
from unittest import TestCase, main as unittest_main

import numpy as np
from scipy.stats import norm
import copy

from gbstats.models.tests import BaseConfig, EffectMoments, EffectMomentsConfig

from gbstats.frequentist.tests import (
    FrequentistConfig,
    TwoSidedTTest,
    SequentialConfig,
    SequentialTwoSidedTTest,
)

from gbstats.bayesian.tests import (
    GaussianPrior,
    EffectBayesianABTest,
    GaussianPrior,
    EffectBayesianConfig,
)

from gbstats.models.statistics import (
    SampleMeanStatistic,
)

from gbstats.power.midexperimentpower import (
    MidExperimentPowerConfig,
    MidExperimentPower,
)


class TestMidExperimentPower(TestCase):
    def setUp(self):
        self.alpha = 0.05  # false positive rate
        self.target_power = 0.8
        self.delta = 0.05
        self.num_goal_metrics = 1
        self.num_variations = 2
        self.power_config_freq = MidExperimentPowerConfig(
            target_power=self.target_power,
            target_mde=self.delta,
            num_goal_metrics=self.num_goal_metrics,
            num_variations=self.num_variations,
            prior_effect=None,
        )
        self.power_config_seq = copy.deepcopy(self.power_config_freq)
        self.power_config_seq.sequential = True
        self.power_config_seq.sequential_tuning_parameter = 5000
        self.power_config_bayes = copy.deepcopy(self.power_config_freq)
        self.mu_prior = 0.05  # prior mean of delta used in the analysis
        self.sigma_2_prior = 0.001  # prior variance of delta used in the analysis
        self.prior_effect = GaussianPrior(
            mean=self.mu_prior, variance=self.sigma_2_prior, proper=True
        )
        self.power_config_bayes.prior_effect = self.prior_effect
        self.config = BaseConfig(alpha=self.alpha)
        self.stat_a = SampleMeanStatistic(
            n=500, sum=499.99999999999994, sum_squares=1499.999999999999
        )
        self.stat_b = SampleMeanStatistic(
            n=500, sum=525.0000000000008, sum_squares=1551.2499999999998
        )
        self.effect_moments = EffectMoments(
            [(self.stat_a, self.stat_b)],
            EffectMomentsConfig(difference_type="relative"),
        )
        self.test_freq = TwoSidedTTest(
            [(self.stat_a, self.stat_b)], FrequentistConfig(alpha=self.alpha)
        )
        self.test_seq = SequentialTwoSidedTTest(
            [(self.stat_a, self.stat_b)], SequentialConfig(alpha=self.alpha)
        )
        self.test_bayes = EffectBayesianABTest(
            [(self.stat_a, self.stat_b)],
            EffectBayesianConfig(prior_effect=self.prior_effect, alpha=self.alpha),
        )
        self.res_freq = self.test_freq.compute_result()
        self.res_seq = self.test_seq.compute_result()
        self.res_bayes = self.test_bayes.compute_result()
        self.m_freq = MidExperimentPower(
            self.test_freq.moments_result,
            self.res_freq,
            self.config,
            self.power_config_freq,
        )
        self.m_seq = MidExperimentPower(
            self.test_seq.moments_result,
            self.res_seq,
            self.config,
            self.power_config_seq,
        )
        self.m_bayes = MidExperimentPower(
            self.test_bayes.moments_result,
            self.res_bayes,
            self.config,
            self.power_config_bayes,
        )
        self.result_freq = self.m_freq.calculate_scaling_factor()
        self.result_seq = self.m_seq.calculate_scaling_factor()
        self.result_bayes = self.m_bayes.calculate_scaling_factor()

    def test_calculate_midexperiment_power_freq(self):
        scaling_factor_true = 25.45703125
        if self.result_freq.scaling_factor:
            self.assertAlmostEqual(
                self.m_freq.power(self.result_freq.scaling_factor), 0.8, places=4
            )
            self.assertAlmostEqual(
                self.result_freq.scaling_factor, scaling_factor_true, places=4
            )
        else:
            raise ValueError("scaling_factor_freq is None")

    def test_calculate_midexperiment_power_seq(self):
        scaling_factor_true = 55.66796875
        if self.result_seq.scaling_factor:
            self.assertAlmostEqual(
                self.m_seq.power(self.result_seq.scaling_factor), 0.8, places=4
            )
            self.assertAlmostEqual(
                self.result_seq.scaling_factor, scaling_factor_true, places=4
            )
        else:
            raise ValueError("scaling_factor_seq is None")

    def test_calculate_midexperiment_power_bayesian(self):
        scaling_factor_true = 13.9404296875
        if self.result_bayes.scaling_factor:
            self.assertAlmostEqual(
                self.m_bayes.power(self.result_bayes.scaling_factor), 0.8, places=4
            )
            self.assertAlmostEqual(
                self.result_bayes.scaling_factor, scaling_factor_true, places=4
            )
        else:
            raise ValueError("scaling_factor_bayes is None")
