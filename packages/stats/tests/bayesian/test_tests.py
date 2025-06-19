from dataclasses import asdict
from functools import partial
from unittest import TestCase, main as unittest_main

import numpy as np
from scipy.stats import norm

from gbstats.bayesian.tests import (
    BayesianTestResult,
    GaussianPrior,
    EffectBayesianABTest,
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
        if k in ["error_message", "risk_type"]:
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
        result = EffectBayesianABTest([(stat_a, stat_b)]).compute_result()
        expected_rounded_dict = asdict(
            BayesianTestResult(
                expected=0.04082,
                ci=[-0.24779, 0.32943],
                uplift=Uplift(dist="normal", mean=0.04082, stddev=0.14725),
                chance_to_win=0.60918,
                risk=[0.0814, 0.04058],
                risk_type="relative",
                error_message=None,
            )
        )
        result_rounded_dict = round_results_dict(asdict(result))
        self.assertDictEqual(result_rounded_dict, expected_rounded_dict)

    def test_missing_data(self):
        result = EffectBayesianABTest(
            [(ProportionStatistic(0, 0), ProportionStatistic(0, 0))]
        ).compute_result()
        self.assertEqual(result.chance_to_win, 0.5)
        self.assertEqual(result.expected, 0)


class TestNorm(TestCase):
    def setUp(self):
        self.stat_a = SampleMeanStatistic(sum=100, sum_squares=1002.25, n=10)
        self.stat_b = SampleMeanStatistic(sum=105, sum_squares=1111.5, n=10)

    def test_bayesian_gaussian_ab_test(self):
        result = EffectBayesianABTest([(self.stat_a, self.stat_b)]).compute_result()
        expected_rounded_dict = asdict(
            BayesianTestResult(
                expected=0.05,
                ci=[-0.02, 0.12],
                uplift=Uplift(dist="normal", mean=0.05, stddev=0.03572),
                chance_to_win=0.91923,
                risk=[0.05131, 0.00131],
                risk_type="relative",
                error_message=None,
            )
        )

        result_rounded_dict = round_results_dict(asdict(result))
        self.assertDictEqual(result_rounded_dict, expected_rounded_dict)

    def test_bayesian_gaussian_ab_test_informative(self):
        result = EffectBayesianABTest(
            [(self.stat_a, self.stat_b)],
            EffectBayesianConfig(
                prior_effect=GaussianPrior(mean=0.1, variance=0.1, proper=True)
            ),
        ).compute_result()
        expected_rounded_dict = asdict(
            BayesianTestResult(
                expected=0.05063,
                ci=[-0.01893, 0.12019],
                uplift=Uplift(dist="normal", mean=0.05063, stddev=0.03549),
                chance_to_win=0.92315,
                risk=[0.05186, 0.00123],
                risk_type="relative",
                error_message=None,
            )
        )

        result_rounded_dict = round_results_dict(asdict(result))
        self.assertDictEqual(result_rounded_dict, expected_rounded_dict)

    def test_missing_data(self):
        result = EffectBayesianABTest(
            [(SampleMeanStatistic(0, 0, 0), SampleMeanStatistic(0, 0, 0))]
        ).compute_result()
        self.assertEqual(result.chance_to_win, 0.5)
        self.assertEqual(result.expected, 0)


class TestEffectBayesianABTest(TestCase):
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

        gaussian_improper_flat_prior = GaussianPrior(proper=False)
        gaussian_flat_prior = GaussianPrior(variance=float(1e6), proper=True)
        gaussian_inf_prior = GaussianPrior(variance=float(1), proper=True)
        effect_config_improper_flat = EffectBayesianConfig(
            difference_type="absolute", prior_effect=gaussian_improper_flat_prior
        )
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

        b_improper_flat = EffectBayesianABTest(
            [(q_stat_c, q_stat_t)], config=effect_config_improper_flat
        ).compute_result()
        b_flat = EffectBayesianABTest(
            [(q_stat_c, q_stat_t)], config=effect_config_flat
        ).compute_result()
        b_relative_flat = EffectBayesianABTest(
            [(q_stat_c, q_stat_t)], config=effect_config_flat_rel
        ).compute_result()
        b_informative = EffectBayesianABTest(
            [(q_stat_c, q_stat_t)], config=effect_config_inf
        ).compute_result()
        b_relative_informative = EffectBayesianABTest(
            [(q_stat_c, q_stat_t)], config=effect_config_inf_rel
        ).compute_result()

        self.assertEqual(b_improper_flat.expected, 0.5365124375579775)
        self.assertEqual(b_flat.expected, 0.536512437540855)
        self.assertEqual(b_relative_flat.expected, 0.07495297222736319)
        self.assertEqual(b_informative.expected, 0.536495315442269)
        self.assertEqual(b_relative_informative.expected, 0.07495037261804469)
        self.assertEqual(b_improper_flat.ci, [0.4572559589115422, 0.6157689162044128])
        self.assertEqual(b_flat.ci, [0.4572559588956844, 0.6157689161860256])
        self.assertEqual(b_relative_flat.ci, [0.06341005842481906, 0.08649588602990732])
        self.assertEqual(b_informative.ci, [0.4572401014910488, 0.6157505293934892])
        self.assertEqual(
            b_relative_informative.ci, [0.06340765898986044, 0.08649308624622894]
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

        b_flat = EffectBayesianABTest(
            [(q_stat_c, q_stat_t)], config=effect_config_flat
        ).compute_result()
        m, s = b_flat.expected, (b_flat.ci[1] - b_flat.ci[0]) / (2 * norm.ppf(0.975))

        np.random.seed(20240329)
        y = s * np.random.normal(size=int(1e7)) + m
        risk_empirical_trt = -np.mean(y[y < 0]) * np.mean(y < 0)
        risk_empirical_ctrl = np.mean(y[y > 0]) * np.mean(y > 0)
        np.testing.assert_almost_equal(b_flat.risk[0], risk_empirical_ctrl, decimal=3)
        np.testing.assert_almost_equal(b_flat.risk[1], risk_empirical_trt, decimal=3)


class TestGaussianEffectRelativeAbsolutePriors(TestCase):
    def test_bayesian_effect_relative_effect(self):
        stat_c = SampleMeanStatistic(n=100, sum=1000, sum_squares=200000)
        stat_t = SampleMeanStatistic(n=100, sum=1100, sum_squares=200005)

        gaussian_inf_prior = GaussianPrior(mean=1, variance=1, proper=True)
        abs_config_inf = EffectBayesianConfig(
            difference_type="absolute", prior_effect=gaussian_inf_prior
        )
        rel_config_inf = EffectBayesianConfig(
            difference_type="relative", prior_effect=gaussian_inf_prior
        )

        abs_test = EffectBayesianABTest([(stat_c, stat_t)], abs_config_inf)
        rel_test = EffectBayesianABTest([(stat_c, stat_t)], rel_config_inf)
        abs_res = abs_test.compute_result()
        rel_res = rel_test.compute_result()

        # rescaling keeps CTW pretty close
        self.assertAlmostEqual(abs_res.chance_to_win, rel_res.chance_to_win, places=2)


if __name__ == "__main__":
    unittest_main()
