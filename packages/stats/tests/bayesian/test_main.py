from functools import partial
from unittest import TestCase, main as unittest_main
import numpy as np
from gbstats.bayesian.main import binomial_ab_test, gaussian_ab_test

DECIMALS = 5
round_ = partial(np.round, decimals=DECIMALS)


class TestBinom(TestCase):
    def test_binomial_ab_test(self):
        result = binomial_ab_test(49, 100, 51, 100)
        expected = {
            "chance_to_win": 0.61052,
            "expected": 0.0404,
            "ci": None,
            "uplift": None,
            "risk": [0.03872, 0.01912],
        }

        for key in expected.keys():
            ex = expected[key]
            res = result[key]

            if ex is None:
                continue
            res = [round_(x) for x in res] if isinstance(res, list) else round_(res)
            ex = [round_(x) for x in ex] if isinstance(ex, list) else round_(ex)
            self.assertEqual(res, ex)

    def test_missing_data(self):
        result = binomial_ab_test(0, 0, 0, 0)
        self.assertEqual(result["chance_to_win"], 0.5)
        self.assertEqual(result["expected"], 0)


class TestNorm(TestCase):
    def test_gaussian_ab_test(self):
        result = gaussian_ab_test(10, 0.5, 10, 10.5, 1, 10)
        expected = {
            "chance_to_win": 0.92427,
            "expected": 0.05,
            "ci": None,
            "uplift": None,
            "risk": [0.51256, 0.01256],
        }

        for key in expected.keys():
            ex = expected[key]
            res = result[key]

            if ex is None:
                continue
            res = [round_(x) for x in res] if isinstance(res, list) else round_(res)
            ex = [round_(x) for x in ex] if isinstance(ex, list) else round_(ex)
            self.assertEqual(res, ex)

    def test_missing_data(self):
        result = gaussian_ab_test(0, 0, 0, 0, 0, 0)
        self.assertEqual(result["chance_to_win"], 0.5)
        self.assertEqual(result["expected"], 0)

    def test_inexact_log_approximation(self):
        expected = {
            "chance_to_win": 0.5,
            "expected": 0,
            "ci": [0, 0],
            "uplift": {"dist": "lognormal", "mean": 0, "stddev": 0},
            "risk": [0, 0],
        }

        result = gaussian_ab_test(
            m_a=0.26, s_a=5.12, n_a=381, m_b=0.84, s_b=12.26, n_b=24145
        )

        for key in expected.keys():
            ex = expected[key]
            res = result[key]

            self.assertEqual(res, ex)


if __name__ == "__main__":
    unittest_main()
