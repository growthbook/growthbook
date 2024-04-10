from dataclasses import asdict
from functools import partial
from unittest import TestCase, main as unittest_main

import numpy as np
from scipy.stats import norm

from gbstats.bayesian.tests import (
    BayesianTestResult,
    BetaPrior,
    BinomialBayesianABTest,
    BinomialBayesianConfig,
    GaussianBayesianABTest,
    GaussianPrior,
    GaussianBayesianConfig,
    GaussianEffectABTest,
    GaussianPrior,
    EffectBayesianConfig,
)
from gbstats.models.statistics import (
    ProportionStatistic,
    SampleMeanStatistic,
    QuantileStatistic,
)
from gbstats.models.tests import Uplift

DECIMALS = 5
round_ = partial(np.round, decimals=DECIMALS)


def round_results_dict(result_dict):
    for k, v in result_dict.items():
        if k == "error_message":
            pass
        elif k == "uplift":
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
            )
        )

        result_rounded_dict = round_results_dict(asdict(result))
        self.assertDictEqual(result_rounded_dict, expected_rounded_dict)

    def test_bayesian_binomial_ab_test_with_prior(self):
        stat_a = ProportionStatistic(sum=49, n=100)
        stat_b = ProportionStatistic(sum=51, n=100)
        result = BinomialBayesianABTest(
            stat_a,
            stat_b,
            BinomialBayesianConfig(
                prior_a=BetaPrior(0, 0), prior_b=BetaPrior(100, 100)
            ),
        ).compute_result()

        expected_rounded_dict = asdict(
            BayesianTestResult(
                expected=0.0309,
                ci=[-0.18162, 0.2986],
                uplift=Uplift(dist="lognormal", mean=0.03043, stddev=0.11778),
                chance_to_win=0.60193,
                risk=[0.03025, 0.01692],
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
            )
        )

        result_rounded_dict = round_results_dict(asdict(result))
        self.assertDictEqual(result_rounded_dict, expected_rounded_dict)

    def test_bayesian_gaussian_ab_test_priors(self):
        result = GaussianBayesianABTest(
            SampleMeanStatistic(sum=100, sum_squares=1002.25, n=10),
            SampleMeanStatistic(sum=105, sum_squares=1111.5, n=10),
            config=GaussianBayesianConfig(
                prior_a=GaussianPrior(0, 100, 1), prior_b=GaussianPrior(0, 20, 1)
            ),
        ).compute_result()

        expected_rounded_dict = asdict(
            BayesianTestResult(
                expected=0.04974,
                ci=[-0.01797, 0.12212],
                uplift=Uplift(dist="lognormal", mean=0.04854, stddev=0.03402),
                chance_to_win=0.9232,
                risk=[0.51017, 0.01277],
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
        ).compute_result()

        for key in expected.keys():
            ex = expected[key]

            self.assertEqual(getattr(result, key), ex)


class TestGaussianEffectABTest(TestCase):
    def test_bayesian_effect_ab_test(self):
        nu = 0.9
        n_c = 11054
        n_t = 10861
        quantile_hat_c = 7.157987489967789
        quantile_hat_t = 7.694499927525767
        quantile_lower_c = 7.098780136176828
        quantile_lower_t = 7.64180598628119
        quantile_upper_c = 7.217194843758751
        quantile_upper_t = 7.747193868770344

        gaussian_flat_prior = GaussianPrior(variance=float(1e6), pseudo_n=1)
        gaussian_inf_prior = GaussianPrior(variance=float(1), pseudo_n=1)
        effect_config_flat = EffectBayesianConfig(
            difference_type="absolute", prior_effect=gaussian_flat_prior
        )
        effect_config_inf = EffectBayesianConfig(
            difference_type="absolute", prior_effect=gaussian_inf_prior
        )
        effect_config_flat_rel = EffectBayesianConfig(
            difference_type="relative", prior_effect=gaussian_flat_prior
        )
        effect_config_inf_rel = EffectBayesianConfig(
            difference_type="relative", prior_effect=gaussian_inf_prior
        )

        q_stat_c = QuantileStatistic(
            n=n_c,
            n_star=n_c,
            nu=nu,
            quantile_hat=quantile_hat_c,
            quantile_lower=quantile_lower_c,
            quantile_upper=quantile_upper_c,
        )
        q_stat_t = QuantileStatistic(
            n=n_t,
            n_star=n_t,
            nu=nu,
            quantile_hat=quantile_hat_t,
            quantile_lower=quantile_lower_t,
            quantile_upper=quantile_upper_t,
        )

        b_flat = GaussianEffectABTest(
            q_stat_c, q_stat_t, config=effect_config_flat
        ).compute_result()
        b_relative_flat = GaussianEffectABTest(
            q_stat_c, q_stat_t, config=effect_config_flat_rel
        ).compute_result()
        b_informative = GaussianEffectABTest(
            q_stat_c, q_stat_t, config=effect_config_inf
        ).compute_result()
        b_relative_informative = GaussianEffectABTest(
            q_stat_c, q_stat_t, config=effect_config_inf_rel
        ).compute_result()

        self.assertEqual(b_flat.expected, 0.5365124367824539)
        self.assertEqual(b_relative_flat.expected, 0.07495297222890572)
        self.assertEqual(b_informative.expected, 0.5357380334109081)
        self.assertEqual(b_relative_informative.expected, 0.07495191495960002)
        self.assertEqual(b_flat.ci, [0.4572559582016913, 0.6157689153632164])
        self.assertEqual(b_relative_flat.ci, [0.06341005842626224, 0.0864958860315492])
        self.assertEqual(b_informative.ci, [0.4565471445922169, 0.6149289222295993])
        self.assertEqual(
            b_relative_informative.ci, [0.06340910198272585, 0.08649472793647417]
        )

        # adding another test for risk
        s = 1
        quantile_lower_c = quantile_hat_c - s
        quantile_lower_t = quantile_hat_t - s
        quantile_upper_c = quantile_hat_c + s
        quantile_upper_t = quantile_hat_t + s
        q_stat_c = QuantileStatistic(
            n=n_c,
            n_star=n_c,
            nu=nu,
            quantile_hat=quantile_hat_c,
            quantile_lower=quantile_lower_c,
            quantile_upper=quantile_upper_c,
        )
        q_stat_t = QuantileStatistic(
            n=n_t,
            n_star=n_t,
            nu=nu,
            quantile_hat=quantile_hat_t,
            quantile_lower=quantile_lower_t,
            quantile_upper=quantile_upper_t,
        )
        b_flat = GaussianEffectABTest(
            q_stat_c, q_stat_t, config=effect_config_flat
        ).compute_result()
        m, s = b_flat.expected, (b_flat.ci[1] - b_flat.ci[0]) / (2 * norm.ppf(0.975))

        np.random.seed(20240329)
        y = s * np.random.normal(size=int(1e7)) + m
        risk_empirical_trt = -np.mean(y[y < 0]) * np.mean(y < 0)
        risk_empirical_ctrl = np.mean(y[y > 0]) * np.mean(y > 0)
        np.testing.assert_almost_equal(b_flat.risk[0], risk_empirical_ctrl, decimal=3)
        np.testing.assert_almost_equal(b_flat.risk[1], risk_empirical_trt, decimal=3)


if __name__ == "__main__":
    unittest_main()
