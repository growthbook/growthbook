from dataclasses import asdict
from functools import partial
from unittest import TestCase, main as unittest_main

import numpy as np
from scipy.stats import norm

from gbstats.frequentist.tests import (
    FrequentistConfig,
    TwoSidedTTest,
    SequentialConfig,
    SequentialTwoSidedTTest,
)

from gbstats.bayesian.tests import (
    BayesianTestResult,
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
        self.stat_a = SampleMeanStatistic(
            n=100, sum=68.70743838631438, sum_squares=8275.876210479892
        )
        self.scaling_factor = 1.0
        self.v_prime = 1.8660831272105125
        self.num_goal_metrics = 3
        self.num_variations = 2
        self.freq_power_config = MidExperimentPowerConfig(
            difference_type="relative",
            traffic_percentage=1,
            phase_length_days=1,
            total_users=None,
            alpha=0.05,
            target_power=0.8,
            m_prime=1,
            v_prime=None,
            sequential=False,
            sequential_tuning_parameter=5000,
            num_goal_metrics=self.num_goal_metrics,
            num_variations=self.num_variations,
        )
        self.seq_power_config = MidExperimentPowerConfig(
            difference_type="relative",
            traffic_percentage=1,
            phase_length_days=1,
            total_users=None,
            alpha=0.05,
            target_power=0.8,
            m_prime=1,
            v_prime=None,
            sequential=True,
            sequential_tuning_parameter=5000,
            num_goal_metrics=self.num_goal_metrics,
            num_variations=self.num_variations,
        )

    def test_calculate_midexperiment_power_freq(self):
        stat_b_freq = SampleMeanStatistic(
            n=100, sum=260.62107614858235, sum_squares=10924.787323128723
        )
        power_true = 0.10589188931752198
        users_true = 4898.4375
        m_prime = 1.0
        freq_config = FrequentistConfig(difference_type="absolute")
        r = TwoSidedTTest(self.stat_a, stat_b_freq, config=freq_config)
        result = r.compute_result()
        power = MidExperimentPower(
            self.stat_a, stat_b_freq, result, freq_config, self.freq_power_config
        )
        power_est = power.calculate_power(self.scaling_factor, m_prime, self.v_prime)
        self.assertAlmostEqual(power_est, power_true, places=5)
        additional_users = power.calculate_sample_size().additional_users
        if not additional_users:
            raise ValueError("additional_users is None")
        else:
            self.assertAlmostEqual(additional_users, users_true, places=5)

    def test_calculate_midexperiment_power_seq(self):
        stat_a_seq = SampleMeanStatistic(
            n=1000, sum=1827.1147009267286, sum_squares=99289.75051582431
        )
        stat_b_seq = SampleMeanStatistic(
            n=1000, sum=2236.14907837543, sum_squares=104082.6977047063
        )
        m_prime = 1.0
        v_prime_seq = 0.1952289663558246
        power_true = 0.05020722743685066
        users_true = 9109.375
        config = SequentialConfig(
            difference_type="absolute",
            traffic_percentage=1,
            phase_length_days=1,
            total_users=None,
            alpha=0.05,
            test_value=0,
        )
        result = SequentialTwoSidedTTest(
            stat_a_seq, stat_b_seq, config=config
        ).compute_result()
        power = MidExperimentPower(
            stat_a_seq, stat_b_seq, result, config, self.seq_power_config
        )
        p = power.calculate_power(self.scaling_factor, m_prime, v_prime_seq)
        self.assertAlmostEqual(p, power_true, places=5)
        additional_users = power.calculate_sample_size().additional_users
        if not additional_users:
            raise ValueError("additional_users is None")
        else:
            self.assertAlmostEqual(additional_users, users_true, places=5)

    def test_calculate_midexperiment_power_bayesian(self):
        stat_b = SampleMeanStatistic(
            n=100, sum=227.71669531352774, sum_squares=10764.102803045413
        )
        m_prime = 0.6709561916494536
        power_true = 0.03870059143882832
        users_true = 11225.0
        config = EffectBayesianConfig(
            difference_type="absolute",
            traffic_percentage=1,
            phase_length_days=1,
            total_users=None,
            alpha=0.05,
            inverse=False,
            prior_type="absolute",
            prior_effect=GaussianPrior(mean=1.0, variance=3.0, proper=True),
        )
        result = EffectBayesianABTest(
            self.stat_a, stat_b, config=config
        ).compute_result()
        power_config = MidExperimentPowerConfig(
            difference_type="relative",
            traffic_percentage=1,
            phase_length_days=1,
            total_users=None,
            alpha=0.05,
            target_power=0.8,
            m_prime=0.6709561916494536,
            v_prime=None,
            sequential=False,
            sequential_tuning_parameter=5000,
            num_goal_metrics=self.num_goal_metrics,
            num_variations=self.num_variations,
        )
        power = MidExperimentPower(self.stat_a, stat_b, result, config, power_config)
        power_est = power.calculate_power(self.scaling_factor, m_prime, self.v_prime)
        self.assertAlmostEqual(power_est, power_true, places=5)
        additional_users = power.calculate_sample_size().additional_users
        if not additional_users:
            raise ValueError("additional_users is None")
        else:
            print(additional_users)
            self.assertAlmostEqual(additional_users, users_true, places=5)
