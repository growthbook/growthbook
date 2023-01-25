from functools import partial
from unittest import TestCase, main as unittest_main

import numpy as np
import pandas as pd
from scipy.special import digamma
from scipy.stats import beta, norm
from gbstats.bayesian.dists import Beta, Norm


DECIMALS = 5
round_ = partial(np.round, decimals=DECIMALS)


def roundsum(x, decimals=DECIMALS):
    return np.round(np.sum(x), decimals=decimals)


class TestBeta(TestCase):
    def test_posterior(self):
        prior = 1, 1
        data = 1, 2
        result = Beta.posterior(prior, data)
        outcome = (2, 2)

        for res, out in zip(result, outcome):
            self.assertEqual(res, out)

        prior = 1, 1
        data = pd.Series([1, 10]), pd.Series([2, 20])
        result = Beta.posterior(prior, data)
        outcome = pd.Series([2, 11]), pd.Series([2, 11])

        for res, out in zip(result, outcome):
            pd.testing.assert_series_equal(res, out)

        prior = pd.Series([1, 2]), pd.Series([1, 3])
        data = pd.Series([1, 10]), pd.Series([2, 20])
        result = Beta.posterior(prior, data)
        outcome = pd.Series([2, 12]), pd.Series([2, 13])

        for res, out in zip(result, outcome):
            pd.testing.assert_series_equal(res, out)

    def test_moments(self):
        pars = 12, 745
        result = Beta.moments(*pars)
        expected = beta.mean(*pars), beta.var(*pars)
        for res, out in zip(result, expected):
            self.assertEqual(round_(res), round_(out))

        pars = 12, 745
        result = Beta.moments(*pars, log=True)
        mean = beta.expect(np.log, pars)
        var = beta.expect(lambda x: np.log(x) ** 2, pars) - mean**2
        expected = mean, var
        for res, out in zip(result, expected):
            self.assertEqual(round_(res), round_(out))

        pars = np.array([12, 745]), np.array([745, 12])
        result = Beta.moments(*pars)
        expected = beta.mean(*pars), beta.var(*pars)
        for res, out in zip(result, expected):
            np.testing.assert_array_almost_equal(res, out)

        self.assertRaises(RuntimeError, Beta.moments, 1, -1)
        self.assertRaises(RuntimeError, Beta.moments, -1, 1)
        self.assertRaises(RuntimeError, Beta.moments, -1, -1)

    def test_gq(self):
        test_cases = zip([10, 100, 500, 1000, 10000], [10000, 1000, 500, 100, 10])
        for a, b in test_cases:
            x, w = Beta.gq(24, a, b)
            for p in range(8):
                self.assertEqual(roundsum(x**p * w), roundsum(beta.moment(p, a, b)))
            self.assertEqual(
                roundsum(np.log(x) * w), roundsum(digamma(a) - digamma(a + b))
            )

    def test_risk_nonnegative(self):
        # Test used to fail before solution to GH issue
        risk = Beta.risk(5563, 1281, 4605, 2888).tolist()
        for r in risk:
            self.assertGreaterEqual(r, 0)


class TestNorm(TestCase):
    def test_posterior(self):
        prior = 0, 1, 10
        data = 12, 1, 10
        result = Norm.posterior(prior, data)
        outcome = (6, np.sqrt(1 / 20))

        for res, out in zip(result, outcome):
            self.assertEqual(res, out)

        prior = 0, 1, 10
        data = pd.Series([12, 100]), pd.Series([1, np.sqrt(2)]), pd.Series([10, 20])
        result = Norm.posterior(prior, data)
        outcome = pd.Series([6.0, 50.0]), pd.Series([np.sqrt(1 / 20), np.sqrt(1 / 20)])

        for res, out in zip(result, outcome):
            pd.testing.assert_series_equal(res, out)

        prior = pd.Series([0, 100]), pd.Series([1, np.sqrt(2)]), pd.Series([10, 20])
        data = pd.Series([12, 100]), pd.Series([1, np.sqrt(2)]), pd.Series([10, 20])
        result = Norm.posterior(prior, data)
        outcome = pd.Series([6.0, 100.0]), pd.Series([np.sqrt(1 / 20), np.sqrt(1 / 20)])

        for res, out in zip(result, outcome):
            pd.testing.assert_series_equal(res, out)

    def test_moments(self):
        pars = 10, 100
        result = Norm.moments(*pars)
        expected = norm.mean(*pars), norm.var(*pars)
        for res, out in zip(result, expected):
            self.assertEqual(round_(res), round_(out))

        pars = 100, 10
        result = Norm.moments(*pars, log=True)
        expected = np.log(100), (10 / 100) ** 2
        for res, out in zip(result, expected):
            self.assertEqual(round_(res), round_(out))

        pars = np.array([10, 100]), np.array([100, 10])
        result = Norm.moments(*pars)
        expected = norm.mean(*pars), norm.var(*pars)
        for res, out in zip(result, expected):
            np.testing.assert_array_almost_equal(res, out)

        self.assertWarns(RuntimeWarning, Norm.moments, 0.1, 1, log=True)
        self.assertRaises(RuntimeError, Norm.moments, 0, 1, log=True)
        self.assertRaises(RuntimeError, Norm.moments, -1, 1, log=True)
        self.assertRaises(RuntimeError, Norm.moments, 1, -1)

    def test_gq(self):
        test_cases = zip([0, -2, 2, 10], [0.01, 1, 4, 0.0001])
        for loc, scale in test_cases:
            x, w = Norm.gq(24, loc, scale)
            for p in range(8):
                self.assertEqual(
                    roundsum(x**p * w), roundsum(norm.moment(p, loc, scale))
                )

        self.assertRaises(RuntimeError, Norm.gq, 24, 0, 0)
        self.assertRaises(RuntimeError, Norm.gq, 24, 0, -1)


if __name__ == "__main__":
    unittest_main()
