from dataclasses import asdict
from functools import partial
from unittest import TestCase, main as unittest_main

import numpy as np

from gbstats.bayesian.tests import BinomialBayesianABTest, GaussianBayesianABTest
from gbstats.shared.models import (
    BayesianTestResult,
    Uplift,
    ProportionStatistic,
    SampleMeanStatistic,
)

DECIMALS = 5
round_ = partial(np.round, decimals=DECIMALS)


def round_results_dict(result_dict):
    # round result
    for k, v in result_dict.items():
        if k == "uplift":
            v = {
                kk: round_(vv) if isinstance(vv, float) else vv for kk, vv in v.items()
            }
        else:
            v = [round_(x) for x in v] if isinstance(v, list) else round_(v)
        result_dict[k] = v
    return result_dict


class TestBinom(TestCase):
    def test_bayesian_binomial_ab_test(self):
        stat_a = ProportionStatistic(sum=49, n=100)
        stat_b = ProportionStatistic(sum=51, n=100)
        result = BinomialBayesianABTest(stat_a, stat_b).compute_result()

        expected_rounded_dict = asdict(
            BayesianTestResult(
                expected=0.0404,
                ci=[-0.21099, 0.37189],
                uplift=Uplift(dist="lognormal", mean=0.03961, stddev=0.14112),
                chance_to_win=0.61052,
                risk=[0.03872, 0.01912],
                relative_risk=[0.07593, 0.03748],
            )
        )

        result_rounded_dict = round_results_dict(asdict(result))
        self.assertDictEqual(result_rounded_dict, expected_rounded_dict)

    def test_missing_data(self):
        result = BinomialBayesianABTest(
            ProportionStatistic(0, 0),
            ProportionStatistic(0, 0),
        ).compute_result()
        self.assertEqual(result.chance_to_win, 0.5)
        self.assertEqual(result.expected, 0)


class TestNorm(TestCase):
    def test_bayesian_gaussian_ab_test(self):
        result = GaussianBayesianABTest(
            SampleMeanStatistic(sum=100, sum_squares=1002.25, n=10),
            SampleMeanStatistic(sum=105, sum_squares=1111.5, n=10),
        ).compute_result()
        expected_rounded_dict = asdict(
            BayesianTestResult(
                expected=0.05,
                ci=[-0.01772, 0.12239],
                uplift=Uplift(dist="lognormal", mean=0.04879, stddev=0.03402),
                chance_to_win=0.92427,
                risk=[0.51256, 0.01256],
                relative_risk=[0.04882, 0.0012],
            )
        )

        result_rounded_dict = round_results_dict(asdict(result))
        self.assertDictEqual(result_rounded_dict, expected_rounded_dict)

    def test_missing_data(self):
        result = GaussianBayesianABTest(
            SampleMeanStatistic(sum=0, sum_squares=0, n=0),
            SampleMeanStatistic(sum=0, sum_squares=0, n=0),
        ).compute_result()
        self.assertEqual(result.chance_to_win, 0.5)
        self.assertEqual(result.expected, 0)

    def test_inexact_log_approximation(self):
        expected = {
            "chance_to_win": 0.5,
            "expected": 0,
            "ci": [0, 0],
            "uplift": Uplift(dist="lognormal", mean=0, stddev=0),
            "risk": [0, 0],
        }

        result = GaussianBayesianABTest(
            SampleMeanStatistic(sum=99.06, sum_squares=9987.2276, n=381),
            SampleMeanStatistic(sum=20281.8, sum_squares=3646063.4064, n=381),
            # Statistic(0.26, 5.12, 381, 381),
            # Statistic(0.84, 12.26, 24145, 24145),
        ).compute_result()

        for key in expected.keys():
            ex = expected[key]

            self.assertEqual(getattr(result, key), ex)


if __name__ == "__main__":
    unittest_main()
