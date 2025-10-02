"""This file tests statistic variances for two reasons:
1. Demonstrating of the expected inputs
2. Demonstrating equivalence to numpy methods that take raw data"""

from unittest import TestCase, main as unittest_main
import copy
import numpy as np
from dataclasses import asdict
from gbstats.messages import ZERO_NEGATIVE_VARIANCE_MESSAGE
from gbstats.models.statistics import (
    ProportionStatistic,
    RatioStatistic,
    RegressionAdjustedStatistic,
    SampleMeanStatistic,
    QuantileStatistic,
    compute_theta,
)

from gbstats.frequentist.tests import FrequentistConfig, TwoSidedTTest

from gbstats.models.tests import (
    EffectMoments,
    EffectMomentsConfig,
    sum_stats,
)

N = 4
METRIC_1 = np.array([0.3, 0.5, 0.9, 22])
METRIC_2 = np.array([1, 1, 1])
METRIC_3 = np.array([2, 1, 5, 3])


class TestSampleMeanStatistic(TestCase):
    def test_sample_mean_statistic(self):
        stat = SampleMeanStatistic(
            sum=np.sum(METRIC_1), sum_squares=np.sum(np.power(METRIC_1, 2)), n=N
        )
        expected_mean = np.mean(METRIC_1)
        expected_var = np.var(METRIC_1, ddof=1)
        self.assertEqual(stat.mean, expected_mean)
        self.assertEqual(stat.variance, expected_var)
        self.assertEqual(stat.mean, stat.unadjusted_mean)

    def test_sample_mean_statistic_low_n(self):
        stat = SampleMeanStatistic(
            sum=np.sum(METRIC_1), sum_squares=np.sum(np.power(METRIC_1, 2)), n=1
        )
        self.assertEqual(stat.variance, 0)


class TestProportionStatistic(TestCase):
    def test_proportion_statistic(self):
        stat = ProportionStatistic(sum=np.sum(METRIC_2), n=N)
        expected_mean = np.sum(METRIC_2) / N
        expected_var = expected_mean * (1 - expected_mean)
        self.assertEqual(stat.sum, stat.sum_squares)
        self.assertEqual(stat.mean, expected_mean)
        self.assertEqual(stat.variance, expected_var)
        self.assertEqual(stat.mean, stat.unadjusted_mean)


class TestRatioStatistic(TestCase):
    def test_ratio_statistic_statistic_covariance(self):
        # Only tests covariance
        m_stat = SampleMeanStatistic(
            sum=np.sum(METRIC_1), sum_squares=np.sum(np.power(METRIC_1, 2)), n=N
        )
        d_stat = SampleMeanStatistic(
            sum=np.sum(METRIC_3), sum_squares=np.sum(np.power(METRIC_3, 2)), n=N
        )
        stat = RatioStatistic(
            m_statistic=m_stat,
            d_statistic=d_stat,
            m_d_sum_of_products=float(np.sum(METRIC_1 * METRIC_3)),
            n=N,
        )
        expected_covariance = np.cov(METRIC_1, METRIC_3)
        self.assertAlmostEqual(stat.covariance, expected_covariance[0, 1])
        self.assertEqual(stat.mean, stat.unadjusted_mean)

    def test_ratio_denom_zero(self):
        m_stat = SampleMeanStatistic(
            sum=np.sum(METRIC_1), sum_squares=np.sum(np.power(METRIC_1, 2)), n=N
        )
        d_stat = SampleMeanStatistic(
            sum=0, sum_squares=np.sum(np.power(METRIC_3, 2)), n=N
        )
        stat = RatioStatistic(
            m_statistic=m_stat,
            d_statistic=d_stat,
            m_d_sum_of_products=float(np.sum(METRIC_1 * METRIC_3)),
            n=N,
        )
        self.assertEqual(stat.variance, 0)


class TestRegressionAdjustedStatistic(TestCase):
    def test_regression_adjusted_statistic(self):
        pre_stat = SampleMeanStatistic(
            sum=np.sum(METRIC_1), sum_squares=np.sum(np.power(METRIC_1, 2)), n=N
        )
        post_stat = SampleMeanStatistic(
            sum=np.sum(METRIC_3), sum_squares=np.sum(np.power(METRIC_3, 2)), n=N
        )
        ra_stat = RegressionAdjustedStatistic(
            post_statistic=post_stat,
            pre_statistic=pre_stat,
            n=N,
            post_pre_sum_of_products=float(np.sum(METRIC_1 * METRIC_3)),
            theta=0,
        )
        expected_unadjusted_mean = np.mean(METRIC_3)
        # when theta = 0
        self.assertEqual(ra_stat.mean, expected_unadjusted_mean)
        self.assertEqual(ra_stat.variance, ra_stat.post_statistic.variance)

        ra_stat_temp = {k: v for k, v in asdict(ra_stat).items() if k != "theta"}
        ra_stat_temp["theta"] = 0.23
        ra_stat = RegressionAdjustedStatistic(**ra_stat_temp)

        self.assertNotEqual(ra_stat.unadjusted_mean, ra_stat.mean)
        self.assertNotEqual(ra_stat.variance, ra_stat.post_statistic.variance)
        self.assertEqual(ra_stat.unadjusted_mean, expected_unadjusted_mean)
        self.assertEqual(ra_stat.unadjusted_mean, ra_stat.post_statistic.mean)

    def test_regression_adjusted_small_n(self):
        n_small = 1
        pre_stat = SampleMeanStatistic(
            sum=np.sum(METRIC_1), sum_squares=np.sum(np.power(METRIC_1, 2)), n=n_small
        )
        post_stat = SampleMeanStatistic(
            sum=np.sum(METRIC_3), sum_squares=np.sum(np.power(METRIC_3, 2)), n=n_small
        )
        ra_stat = RegressionAdjustedStatistic(
            post_statistic=post_stat,
            pre_statistic=pre_stat,
            n=n_small,
            post_pre_sum_of_products=float(np.sum(METRIC_1 * METRIC_3)),
            theta=0.3,
        )
        self.assertEqual(ra_stat.variance, 0)


class TestComputeTheta(TestCase):
    def test_returns_0_no_variance(self):
        pre_stat_a = SampleMeanStatistic(
            sum=np.sum(METRIC_1), sum_squares=np.sum(np.power(METRIC_1, 2)), n=N
        )
        post_stat_a = SampleMeanStatistic(
            sum=np.sum(METRIC_3), sum_squares=np.sum(np.power(METRIC_3, 2)), n=N
        )
        pre_stat_b = SampleMeanStatistic(
            sum=np.sum(METRIC_1), sum_squares=np.sum(np.power(METRIC_1, 2)), n=N
        )
        post_stat_b = SampleMeanStatistic(
            sum=np.sum(METRIC_3), sum_squares=np.sum(np.power(METRIC_3, 2)), n=N
        )
        ra_stat_a = RegressionAdjustedStatistic(
            post_statistic=post_stat_a,
            pre_statistic=pre_stat_a,
            n=N,
            post_pre_sum_of_products=float(np.sum(METRIC_1 * METRIC_3)),
            theta=999,
        )
        ra_stat_b = RegressionAdjustedStatistic(
            post_statistic=post_stat_b,
            pre_statistic=pre_stat_b,
            n=N,
            post_pre_sum_of_products=float(np.sum(METRIC_1 * METRIC_3)),
            theta=999,
        )
        self.assertEqual(round(compute_theta(ra_stat_a, ra_stat_b), 5), 0.01864)

        pre_stat_a = SampleMeanStatistic(n=N, sum=0, sum_squares=0)
        pre_stat_b = SampleMeanStatistic(n=N, sum=0, sum_squares=0)
        ra_stat_a = RegressionAdjustedStatistic(
            post_statistic=post_stat_a,
            pre_statistic=pre_stat_a,
            n=N,
            post_pre_sum_of_products=0,
            theta=999,
        )
        ra_stat_b = RegressionAdjustedStatistic(
            post_statistic=post_stat_b,
            pre_statistic=pre_stat_b,
            n=N,
            post_pre_sum_of_products=0,
            theta=999,
        )
        self.assertEqual(compute_theta(ra_stat_a, ra_stat_b), 0)


class TestSumStats(TestCase):
    def setUp(self):
        self.stat_a_0 = SampleMeanStatistic(n=500, sum=10, sum_squares=75)
        self.stat_a_1 = SampleMeanStatistic(n=500, sum=40, sum_squares=73)
        self.stat_a_2 = SampleMeanStatistic(n=500, sum=10, sum_squares=75)
        self.stat_a_3 = SampleMeanStatistic(n=500, sum=40, sum_squares=73)
        self.stat_b_0 = SampleMeanStatistic(n=500, sum=4, sum_squares=7)
        self.stat_b_1 = SampleMeanStatistic(n=500, sum=20, sum_squares=13)
        self.stat_b_2 = SampleMeanStatistic(n=500, sum=4, sum_squares=7)
        self.stat_b_3 = SampleMeanStatistic(n=500, sum=20, sum_squares=13)

        nu = 0.9
        n_c = 11054
        n_t = 10861
        quantile_hat_c = 7.157987489967789
        quantile_hat_t = 7.694499927525767
        quantile_lower_c = 7.098780136176828
        quantile_lower_t = 7.64180598628119
        quantile_upper_c = 7.217194843758751
        quantile_upper_t = 7.747193868770344
        self.q_stat_c = QuantileStatistic(
            n=n_c,
            n_star=n_c,
            nu=nu,
            quantile_hat=quantile_hat_c,
            quantile_lower=quantile_lower_c,
            quantile_upper=quantile_upper_c,
        )
        self.q_stat_t = QuantileStatistic(
            n=n_t,
            n_star=n_t,
            nu=nu,
            quantile_hat=quantile_hat_t,
            quantile_lower=quantile_lower_t,
            quantile_upper=quantile_upper_t,
        )

    # assert we can sum statistics
    def test_sum_correct(self):
        stat_a_true = self.stat_a_0 + self.stat_a_1 + self.stat_a_2 + self.stat_a_3
        stat_b_true = self.stat_b_0 + self.stat_b_1 + self.stat_b_2 + self.stat_b_3
        stat_a, stat_b = sum_stats(
            [
                (self.stat_a_0, self.stat_b_0),
                (self.stat_a_1, self.stat_b_1),
                (self.stat_a_2, self.stat_b_2),
                (self.stat_a_3, self.stat_b_3),
            ]
        )
        self.assertEqual(stat_a, stat_a_true)
        self.assertEqual(stat_b, stat_b_true)

    # assert that if there is only one quantile statistic, we can sum it
    def test_quantile_success(self):
        q_stat_c_2, q_stat_t_2 = sum_stats([(self.q_stat_c, self.q_stat_t)])
        self.assertEqual(q_stat_c_2, self.q_stat_c)
        self.assertEqual(q_stat_t_2, self.q_stat_t)

    # assert that if we pass in multiple quantile statistics, we get error
    def test_quantile_failure(self):
        with self.assertRaises(ValueError):
            sum_stats([(self.q_stat_c, self.q_stat_t), (self.q_stat_c, self.q_stat_t)])


# Statistics for EffectMoments
RASTAT_A = RegressionAdjustedStatistic(
    post_statistic=ProportionStatistic(n=4, sum=1),
    pre_statistic=ProportionStatistic(n=4, sum=0),
    n=4,
    post_pre_sum_of_products=0,
    theta=None,
)

RASTAT_B = RegressionAdjustedStatistic(
    post_statistic=ProportionStatistic(n=3, sum=1),
    pre_statistic=ProportionStatistic(n=3, sum=1),
    n=3,
    post_pre_sum_of_products=1,
    theta=None,
)


class TestEffectMomentsResult(TestCase):
    def test_negative_variance(self):
        stat_a_init = {
            k: v for k, v in asdict(RASTAT_A).items() if k != "post_statistic"
        }
        stat_b = RASTAT_B
        post_statistic = ProportionStatistic(n=RASTAT_A.n, sum=-7)
        stat_a = RegressionAdjustedStatistic(
            **stat_a_init, post_statistic=post_statistic
        )
        test = TwoSidedTTest(
            stats=[(stat_a, stat_b)],
            config=FrequentistConfig(difference_type="absolute"),
        )
        moments = EffectMoments(
            [(test.stat_a, test.stat_b)],
            config=EffectMomentsConfig(difference_type="absolute"),
        )
        self.assertEqual(moments.variance, -1.1023019547325101)
        self.assertEqual(
            moments.compute_result().error_message, ZERO_NEGATIVE_VARIANCE_MESSAGE
        )


if __name__ == "__main__":
    unittest_main()
