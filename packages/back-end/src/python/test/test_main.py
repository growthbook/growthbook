from functools import partial
from unittest import TestCase, main as unittest_main
import numpy as np
from main import binomial_ab_test, gaussian_ab_test

DECIMALS = 5
round_ = partial(np.round, decimals=DECIMALS)


class TestBinom(TestCase):
    def test_binomial_ab_test(self):
        result = binomial_ab_test(1, 1, 1, 1)
        expected = {'chance_to_win': 0.5,
                    'expected': 0.0,
                    'ci': None,
                    'uplift': None,
                    'risk': [0.15, 0.15]}

        for key in expected.keys():
            ex = expected[key]
            res = result[key]

            if ex is None:
                continue
            res = [round_(x) for x in res] if isinstance(res, list) else round_(res)
            ex = [round_(x) for x in ex] if isinstance(ex, list) else round_(ex)
            self.assertEqual(res, ex)


class TestNorm(TestCase):
    def test_gaussian_ab_test(self):
        result = gaussian_ab_test(10, .1, 1, 10, .1, 1)
        expected = {'chance_to_win': 0.5,
                    'expected': 0.0,
                    'ci': None,
                    'uplift': None,
                    'risk': [0.05642, 0.05642]}

        for key in expected.keys():
            ex = expected[key]
            res = result[key]

            if ex is None:
                continue
            res = [round_(x) for x in res] if isinstance(res, list) else round_(res)
            ex = [round_(x) for x in ex] if isinstance(ex, list) else round_(ex)
            self.assertEqual(res, ex)


if __name__ == '__main__':
    unittest_main()
