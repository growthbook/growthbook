from dataclasses import asdict
from functools import partial
from unittest import TestCase, main as unittest_main

import numpy as np
from scipy.stats import norm
import copy

from gbstats.utils import (
    check_srm,
    frequentist_diff,
    multinomial_covariance,
    truncated_normal_mean,
)
from scipy.stats import truncnorm

DECIMALS = 5
round_ = partial(np.round, decimals=DECIMALS)


class TestFrequentistDiff(TestCase):
    def test_absolute_is_plain_difference(self):
        self.assertEqual(frequentist_diff(-10, -5, relative=False), 5)
        self.assertEqual(frequentist_diff(10, 15, relative=False), 5)

    def test_relative_positive_baseline(self):
        self.assertAlmostEqual(frequentist_diff(10, 15, relative=True), 0.5)
        self.assertAlmostEqual(frequentist_diff(10, 5, relative=True), -0.5)

    def test_relative_negative_baseline_keeps_direction(self):
        # -10 -> -5 is an increase; the relative difference must be positive
        self.assertAlmostEqual(frequentist_diff(-10, -5, relative=True), 0.5)
        # -10 -> -15 is a decrease
        self.assertAlmostEqual(frequentist_diff(-10, -15, relative=True), -0.5)
        # crossing zero
        self.assertAlmostEqual(frequentist_diff(-2, 3, relative=True), 2.5)

    def test_relative_uses_unadjusted_baseline_magnitude(self):
        # CUPED-adjusted means with an unadjusted (negative) baseline
        self.assertAlmostEqual(
            frequentist_diff(-9, -4, relative=True, mean_a_unadjusted=-10), 0.5
        )


class TestCheckSrm(TestCase):
    # Mirrors checkSrm in packages/back-end/src/util/stats.ts, which computes
    # the SRM shown on the health tab from the same users/weights.
    def test_matches_backend_values(self):
        self.assertAlmostEqual(check_srm([1000, 1200], [0.5, 0.5]), 0.000020079, 9)
        self.assertAlmostEqual(check_srm([310, 98], [0.75, 0.25]), 0.647434186, 9)
        self.assertAlmostEqual(
            check_srm([500, 500, 600], [0.34, 0.33, 0.33]), 0.000592638, 9
        )
        self.assertEqual(check_srm([500, 500], [0.5, 0.5]), 1)
        self.assertEqual(check_srm([0, 0, 0], [0.34, 0.33, 0.33]), 1)

    def test_skips_zero_weight_variation(self):
        # A 0% variation is left out entirely, so its users are not expected
        # to show up in the other arms and it adds no degree of freedom.
        self.assertAlmostEqual(
            check_srm([1000, 1200, 900], [0.5, 0.5, 0]), 0.000020079, 9
        )
        self.assertAlmostEqual(
            check_srm([10000, 10500, 0], [0.5, 0.5, 0]),
            check_srm([10000, 10500], [0.5, 0.5]),
        )

    def test_needs_two_weighted_variations(self):
        self.assertEqual(check_srm([1000, 900, 800], [1, 0, 0]), 1)


class TestTruncatedNormalMean(TestCase):
    def _scipy_ref(self, mu, sigma, a, b):
        alpha, beta = (a - mu) / sigma, (b - mu) / sigma
        mn, *_ = truncnorm.stats(alpha, beta, loc=mu, scale=sigma, moments="mvsk")
        return float(mn)

    def test_matches_scipy_below_threshold(self):
        # For |beta| < 1e3 we still delegate to scipy, so result must be bit-exact.
        for beta_mag in (10.0, 100.0, 999.0):
            mu, sigma = beta_mag, 1.0  # b=0 => beta = -mu/sigma = -beta_mag
            got = truncated_normal_mean(mu=mu, sigma=sigma, a=-np.inf, b=0.0)
            want = self._scipy_ref(mu=mu, sigma=sigma, a=-np.inf, b=0.0)
            self.assertEqual(got, want)
            # mirror: upper tail
            got_u = truncated_normal_mean(mu=-mu, sigma=sigma, a=0.0, b=np.inf)
            want_u = self._scipy_ref(mu=-mu, sigma=sigma, a=0.0, b=np.inf)
            self.assertEqual(got_u, want_u)

    def test_mills_asymptotic_extreme_beta(self):
        # For |beta| >= 1e3 we use the Mills asymptotic b + sigma**2/(b - mu).
        # It must be finite and agree with the analytic form.
        sigma = 4.5e-9
        for mu in (4.5e-6, 4.5e-3, 4.5, 10.8):  # |beta| = 1e3, 1e6, 1e9, 2.4e9
            got = truncated_normal_mean(mu=mu, sigma=sigma, a=-np.inf, b=0.0)
            self.assertTrue(np.isfinite(got))
            analytic = 0.0 + sigma**2 / (0.0 - mu)
            self.assertAlmostEqual(got / analytic, 1.0, places=6)
            self.assertLess(got, 0.0)  # E[X | X < 0] must be negative
            # mirror: upper tail
            got_u = truncated_normal_mean(mu=-mu, sigma=sigma, a=0.0, b=np.inf)
            self.assertTrue(np.isfinite(got_u))
            self.assertAlmostEqual(got_u / (-analytic), 1.0, places=6)

    def test_no_overflow_at_repro_point(self):
        # Regression: this used to raise OverflowError inside scipy truncnorm.
        got = truncated_normal_mean(mu=0.01, sigma=4.5e-9, a=-np.inf, b=0.0)
        self.assertTrue(np.isfinite(got))


class TestMultinomial(TestCase):
    def setUp(self):
        self.seed = 20251204
        rng_nu = np.random.default_rng(seed=self.seed)
        self.num_cells = 5
        nu = rng_nu.uniform(size=self.num_cells)
        nu = nu / np.sum(nu)
        self.nu = nu
        self.size = 1000000
        self.n = 1000

    def test_multinomial_covariance(self):
        rng_data = np.random.default_rng(seed=self.seed + 1)
        data = rng_data.multinomial(n=1, pvals=self.nu, size=self.size)
        v_theoretical = multinomial_covariance(self.nu)
        v_empirical = np.cov(data, rowvar=False, ddof=1)
        self.assertTrue(np.allclose(v_theoretical, v_empirical, atol=1e-3))
