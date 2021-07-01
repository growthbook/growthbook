from unittest import TestCase

import numpy as np
from scipy.stats import beta, norm
from scipy.special import digamma
from dists import Beta, Norm


DECIMALS = 5


def roundsum(x, decimals=DECIMALS):
    return np.round(np.sum(x), decimals=decimals)


class TestBeta(TestCase):
    def test_posterior(self):
        self.fail()

    def test_moments(self):
        self.fail()

    def test_gq(self):
        test_cases = zip([10, 100, 500, 1000, 10000],
                         [10000, 1000, 500, 100, 10])
        for a, b in test_cases:
            x, w = Beta.gq(24, a, b)
            for p in range(8):
                self.assertEqual(roundsum(x ** p * w), roundsum(beta.moment(p, a, b)))
            self.assertEqual(roundsum(np.log(x) * w), roundsum(digamma(a) - digamma(a + b)))


class TestNorm(TestCase):
    def test_posterior(self):
        self.fail()

    def test_moments(self):
        self.fail()

    def test_gq(self):
        test_cases = zip([0, -2, 2, 10],
                         [.01, 1, 4, .0001])
        for loc, scale in test_cases:
            x, w = Norm.gq(24, loc, scale)
            for p in range(8):
                self.assertEqual(roundsum(x ** p * w), roundsum(norm.moment(p, loc, scale)))
