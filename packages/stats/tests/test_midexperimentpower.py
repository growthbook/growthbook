from unittest import TestCase

import numpy as np

from gbstats.frequentist.tests import (
    FrequentistConfig,
    TwoSidedTTest,
)

from gbstats.bayesian.tests import (
    EffectBayesianABTest,
    GaussianPrior,
    EffectBayesianConfig,
)

from gbstats.models.statistics import (
    SampleMeanStatistic,
)

from gbstats.gbstats import get_mid_experiment_power_inputs
from gbstats.models.settings import MetricSettingsForStatsEngine


class TestMidExperimentPowerInputs(TestCase):
    def setUp(self):
        self.alpha = 0.05
        self.delta = 0.05
        self.mu_prior = 0.05
        self.sigma_2_prior = 0.001
        self.stat_a = SampleMeanStatistic(
            n=500, sum=499.99999999999994, sum_squares=1499.999999999999
        )
        self.stat_b = SampleMeanStatistic(
            n=500, sum=525.0000000000008, sum_squares=1551.2499999999998
        )
        self.metric = MetricSettingsForStatsEngine(
            id="m",
            name="m",
            statistic_type="mean",
            main_metric_type="count",
            target_mde=self.delta,
            prior_proper=True,
            prior_mean=self.mu_prior,
            prior_stddev=float(np.sqrt(self.sigma_2_prior)),
        )

    def test_frequentist(self):
        test = TwoSidedTTest(
            [(self.stat_a, self.stat_b)], FrequentistConfig(alpha=self.alpha)
        )
        power = get_mid_experiment_power_inputs(
            test.moments_result, test.compute_result(), self.metric
        )
        self.assertEqual(power.status, "successful")
        self.assertEqual(power.firstPeriodPairwiseSampleSize, 1000)
        assert power.sigmahat2Delta is not None
        self.assertAlmostEqual(
            power.sigmahat2Delta, test.moments_result.standard_error**2
        )
        self.assertEqual(power.targetMDE, self.delta)
        self.assertIsNone(power.priorProper)
        self.assertIsNone(power.scalingFactor)

    def test_bayesian(self):
        test = EffectBayesianABTest(
            [(self.stat_a, self.stat_b)],
            EffectBayesianConfig(
                prior_effect=GaussianPrior(
                    mean=self.mu_prior, variance=self.sigma_2_prior, proper=True
                ),
                alpha=self.alpha,
            ),
        )
        power = get_mid_experiment_power_inputs(
            test.moments_result, test.compute_result(), self.metric
        )
        self.assertTrue(power.priorProper)
        self.assertEqual(power.priorLiftMean, self.mu_prior)
        assert power.priorLiftVariance is not None
        self.assertAlmostEqual(power.priorLiftVariance, self.sigma_2_prior)
        self.assertIsNone(power.scalingFactor)

    def test_errored_test(self):
        no_variance = SampleMeanStatistic(n=500, sum=500, sum_squares=500)
        test = TwoSidedTTest(
            [(no_variance, no_variance)], FrequentistConfig(alpha=self.alpha)
        )
        power = get_mid_experiment_power_inputs(
            test.moments_result, test.compute_result(), self.metric
        )
        self.assertEqual(power.status, "unsuccessful")
        self.assertIsNotNone(power.errorMessage)
        self.assertEqual(power.sigmahat2Delta, 0)
        self.assertIs(power.upperBoundAchieved, False)
