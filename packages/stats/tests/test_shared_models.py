"""This file tests statistic variances for two reasons:
1. Demonstrating of the expected inputs
2. Demonstrating equivalence to numpy methods that take raw data"""
from functools import partial
from unittest import TestCase, main as unittest_main

import numpy as np

from gbstats.shared.models import (
    SampleMeanStatistic,
    ProportionStatistic,
    RatioStatistic,
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


class TestProportionStatistic(TestCase):
    def test_proportion_statistic(self):
        stat = ProportionStatistic(sum=np.sum(METRIC_2), n=N)
        expected_mean = np.sum(METRIC_2) / N
        expected_var = expected_mean * (1 - expected_mean)
        self.assertEqual(stat.sum, stat.sum_squares)
        self.assertEqual(stat.mean, expected_mean)
        self.assertEqual(stat.variance, expected_var)


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
            m_d_sum_of_products=np.sum(METRIC_1 * METRIC_3),
            n=N,
        )
        expected_covariance = np.cov(METRIC_1, METRIC_3)
        self.assertAlmostEqual(stat.covariance, expected_covariance[0, 1])


if __name__ == "__main__":
    unittest_main()
