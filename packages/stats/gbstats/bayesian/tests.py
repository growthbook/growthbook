from abc import abstractmethod
from dataclasses import field
from typing import List, Literal, Optional

import numpy as np
from pydantic.dataclasses import dataclass
from scipy.stats import norm

from gbstats.messages import (
    BASELINE_VARIATION_ZERO_MESSAGE,
    ZERO_NEGATIVE_VARIANCE_MESSAGE,
    ZERO_SCALED_VARIATION_MESSAGE,
    NO_UNITS_IN_VARIATION_MESSAGE,
)
from gbstats.models.tests import BaseABTest, BaseConfig, TestResult, Uplift
from gbstats.models.statistics import (
    TestStatistic,
    ProportionStatistic,
    SampleMeanStatistic,
    RegressionAdjustedStatistic,
)
from gbstats.frequentist.tests import (
    frequentist_diff,
    frequentist_variance,
)
from gbstats.utils import (
    truncated_normal_mean,
    gaussian_credible_interval,
)


# Configs
@dataclass
class GaussianPrior:
    mean: float = 0
    variance: float = 1
    proper: bool = False


@dataclass
class BayesianConfig(BaseConfig):
    inverse: bool = False
    prior_type: Literal["relative", "absolute"] = "relative"


@dataclass
class EffectBayesianConfig(BayesianConfig):
    prior_effect: GaussianPrior = field(default_factory=GaussianPrior)


# Results
RiskType = Literal["absolute", "relative"]


@dataclass
class BayesianTestResult(TestResult):
    chance_to_win: float
    risk: List[float]
    risk_type: RiskType
    error_message: Optional[str] = None


class BayesianABTest(BaseABTest):
    def __init__(
        self,
        stat_a: TestStatistic,
        stat_b: TestStatistic,
        config: BayesianConfig = BayesianConfig(),
    ):
        super().__init__(stat_a, stat_b)
        self.alpha = config.alpha
        self.inverse = config.inverse
        self.relative = config.difference_type == "relative"
        self.scaled = config.difference_type == "scaled"
        self.traffic_percentage = config.traffic_percentage
        self.total_users = config.total_users
        self.phase_length_days = config.phase_length_days

    @abstractmethod
    def compute_result(self) -> BayesianTestResult:
        pass

    def _default_output(
        self, error_message: Optional[str] = None
    ) -> BayesianTestResult:
        """Return uninformative output when AB test analysis can't be performed
        adequately
        """
        return BayesianTestResult(
            chance_to_win=0.5,
            expected=0,
            ci=[0, 0],
            uplift=Uplift(dist="normal", mean=0, stddev=0),
            risk=[0, 0],
            error_message=error_message,
            risk_type="relative" if self.relative else "absolute",
        )

    def has_empty_input(self):
        return self.stat_a.n == 0 or self.stat_b.n == 0

    def chance_to_win(self, mean_diff: float, std_diff: float) -> float:
        if self.inverse:
            return 1 - norm.sf(0, mean_diff, std_diff)  # type: ignore
        else:
            return norm.sf(0, mean_diff, std_diff)  # type: ignore

    def scale_result(self, result: BayesianTestResult) -> BayesianTestResult:
        if result.uplift.dist != "normal":
            raise ValueError("Cannot scale relative results.")
        if self.phase_length_days == 0 or self.traffic_percentage == 0:
            return self._default_output(ZERO_SCALED_VARIATION_MESSAGE)
        if isinstance(
            self.stat_a,
            (ProportionStatistic, SampleMeanStatistic, RegressionAdjustedStatistic),
        ):
            if self.total_users:
                daily_traffic = self.total_users / (
                    self.traffic_percentage * self.phase_length_days
                )
                return BayesianTestResult(
                    chance_to_win=result.chance_to_win,
                    expected=result.expected * daily_traffic,
                    ci=[result.ci[0] * daily_traffic, result.ci[1] * daily_traffic],
                    uplift=Uplift(
                        dist=result.uplift.dist,
                        mean=result.uplift.mean * daily_traffic,
                        stddev=result.uplift.stddev * daily_traffic,
                    ),
                    risk=result.risk,
                    risk_type=result.risk_type,
                )
            else:
                return self._default_output(NO_UNITS_IN_VARIATION_MESSAGE)
        else:
            error_str = "For scaled impact the statistic must be of type ProportionStatistic, SampleMeanStatistic, or RegressionAdjustedStatistic"
            return self._default_output(error_str)


class EffectBayesianABTest(BayesianABTest):
    def __init__(
        self,
        stat_a: TestStatistic,
        stat_b: TestStatistic,
        config: EffectBayesianConfig = EffectBayesianConfig(),
    ):
        super().__init__(stat_a, stat_b, config)
        self.stat_a = stat_a
        self.stat_b = stat_b
        self.config = config

    def compute_result(self):
        if (
            self.stat_a.mean == 0 or self.stat_a.unadjusted_mean == 0
        ) and self.relative:
            return self._default_output(BASELINE_VARIATION_ZERO_MESSAGE)
        if self.has_empty_input():
            return self._default_output(NO_UNITS_IN_VARIATION_MESSAGE)
        if self._has_zero_variance():
            return self._default_output(ZERO_NEGATIVE_VARIANCE_MESSAGE)

        # rescale prior if needed
        scaled_prior_effect = self.config.prior_effect
        if self.relative and self.config == "absolute":
            scaled_prior_effect = GaussianPrior(
                self.config.prior_effect.mean / abs(self.stat_a.unadjusted_mean),
                self.config.prior_effect.variance / pow(self.stat_a.unadjusted_mean, 2),
                self.config.prior_effect.proper,
            )
        elif not self.relative and self.config.prior_type == "relative":
            if self.config.prior_effect.proper and self.stat_a.unadjusted_mean == 0:
                return self._default_output(BASELINE_VARIATION_ZERO_MESSAGE)
            scaled_prior_effect = GaussianPrior(
                self.config.prior_effect.mean * abs(self.stat_a.unadjusted_mean),
                self.config.prior_effect.variance * pow(self.stat_a.unadjusted_mean, 2),
                self.config.prior_effect.proper,
            )

        data_variance = frequentist_variance(
            self.stat_a.variance,
            self.stat_a.unadjusted_mean,
            self.stat_a.n,
            self.stat_b.variance,
            self.stat_b.unadjusted_mean,
            self.stat_b.n,
            self.relative,
        )
        data_mean = frequentist_diff(
            self.stat_a.mean,
            self.stat_b.mean,
            self.relative,
            self.stat_a.unadjusted_mean,
        )

        post_prec = 1 / data_variance + (
            1 / scaled_prior_effect.variance if scaled_prior_effect.proper else 0
        )
        self.mean_diff = (
            (
                data_mean / data_variance
                + scaled_prior_effect.mean / scaled_prior_effect.variance
            )
            / post_prec
            if scaled_prior_effect.proper
            else data_mean
        )
        self.std_diff = np.sqrt(1 / post_prec)

        ctw = self.chance_to_win(self.mean_diff, self.std_diff)
        ci = gaussian_credible_interval(self.mean_diff, self.std_diff, self.alpha)
        risk = self.get_risk(self.mean_diff, self.std_diff)
        # flip risk for inverse metrics
        risk = [risk[0], risk[1]] if not self.inverse else [risk[1], risk[0]]

        result = BayesianTestResult(
            chance_to_win=ctw,
            expected=self.mean_diff,
            ci=ci,
            uplift=Uplift(
                dist="normal",
                mean=self.mean_diff,
                stddev=self.std_diff,
            ),
            risk=risk,
            risk_type="relative" if self.relative else "absolute",
        )
        if self.scaled:
            result = self.scale_result(result)
        return result

    @staticmethod
    def get_risk(mu, sigma) -> List[float]:
        prob_ctrl_is_better = norm.cdf(0.0, loc=mu, scale=sigma)
        mn_neg = truncated_normal_mean(mu=mu, sigma=sigma, a=-np.inf, b=0.0)
        mn_pos = truncated_normal_mean(mu=mu, sigma=sigma, a=0, b=np.inf)
        risk_ctrl = float((1.0 - prob_ctrl_is_better) * mn_pos)
        risk_trt = -float(prob_ctrl_is_better * mn_neg)
        return [risk_ctrl, risk_trt]


# class CalculateRequiredSampleSize:
#     def __init__(
#         self,
#         stat_a: TestStatistic,
#         stat_b: TestStatistic,
#         config: EffectBayesianConfig,
#         test_result: BayesianTestResult,
#     ):
#         self.stat_a = stat_a
#         self.stat_b = stat_b
#         self.config = config
#         self.relative = self.config.difference_type == "relative"
#         self.test_result = test_result

#     def calculate_sample_size(self):
#         if self.test_result:
#             self.scaling_factor = self.find_scaling_factor()
#             self.sample_size = self.total_sample_size * self.scaling_factor

#     @property
#     def total_sample_size(self) -> int:
#         return self.stat_a.n + self.stat_b.n

#     @property
#     def z_star(self) -> float:
#         return float(norm.ppf(1 - self.config.alpha / 2))

#     @property
#     def max_iters(self) -> int:
#         return 1000

#     @property
#     def delta_posterior(self) -> float:
#         return self.test_result.expected

#     @property
#     def sigma_2_posterior(self) -> float:
#         return self.test_result.uplift.stddev ** 2

#     @property
#     def sigmahat_2_delta(self) -> float:
#         return frequentist_variance(
#             self.stat_a.variance,
#             self.stat_a.unadjusted_mean,
#             self.stat_a.n,
#             self.stat_b.variance,
#             self.stat_b.unadjusted_mean,
#             self.stat_b.n,
#             self.relative,
#         )

#     def find_scaling_factor_bound(self, upper=True) -> Tuple[float, bool]:
#         """
#         Finds the lower bound for the scaling factor.

#         Args:
#             delta_posterior: A delta posterior value.
#             sigma_2_posterior: A posterior variance.
#             sigmahat_2_delta: A delta variance.

#         Returns:
#             The lower bound for the scaling factor.
#         """
#         scaling_factor = 1
#         current_power = self.power(self.delta_posterior, self.sigma_2_posterior, self.sigmahat_2_delta, self.z_star, scaling_factor)
#         iters = 0
#         converged = False
#         multiplier = 2 if upper else 0.5
#         while current_power > 0.8 and iters < 20:
#             scaling_factor *= multiplier
#             current_power = self.power(self.delta_posterior, self.sigma_2_posterior, self.sigmahat_2_delta, self.z_star, scaling_factor)
#             iters += 1
#         if iters < self.max_iters:
#             converged = True
#         return scaling_factor, converged

#     def find_scaling_factor(self):
#         scaling_factor = 1
#         current_power = closed_form_power(scaling_factor, delta_posterior, sigma_2_posterior, sigmahat_2_delta)
#         scaling_factor_small = find_lower_bound(delta_posterior, sigma_2_posterior, sigmahat_2_delta)
#         scaling_factor_big = find_upper_bound(delta_posterior, sigma_2_posterior, sigmahat_2_delta)
#         diff = current_power - 0.8
#         n_iters = 0
#         max_iters = 10000

#         while abs(diff) > 1e-3 and n_iters < max_iters:
#             if diff < 0:
#                 scaling_factor_small = scaling_factor
#             else:
#                 scaling_factor_big = scaling_factor

#             scaling_factor = 0.5 * (scaling_factor_small + scaling_factor_big)
#             current_power = closed_form_power(scaling_factor, delta_posterior, sigma_2_posterior, sigmahat_2_delta)
#             diff = current_power - 0.8
#             n_iters += 1

#         converged = n_iters < max_iters
#         return scaling_factor, converged


#     @staticmethod
#     def power(delta_posterior, sigma_2_posterior, sigmahat_2_delta, z_star, scaling_factor) -> float:
#         """
#         Args:
#             delta_posterior: posterior mean.
#             sigma_2_posterior: posterior variance.
#             sigmahat_2_delta: frequentist variance.
#             z_star: Z-score for statistical significance.
#             scaling_factor: multipicative factor for sample size.

#         Returns:
#             power estimate.
#         """
#         v = CalculateRequiredSampleSize.final_posterior_variance(sigma_2_posterior, sigmahat_2_delta, scaling_factor)
#         s = np.sqrt(v)
#         marginal_var = CalculateRequiredSampleSize.marginal_variance_delta_hat_prime(sigma_2_posterior, sigmahat_2_delta, scaling_factor)
#         num_1 = s * z_star * marginal_var / sigma_2_posterior
#         num_2 = (sigmahat_2_delta / scaling_factor) * delta_posterior / sigma_2_posterior
#         num_3 = delta_posterior
#         den = np.sqrt(marginal_var)
#         num_pos = num_1 - num_2 - num_3
#         num_neg = -num_1 - num_2 - num_3
#         power_pos = float(1 - norm.cdf(num_pos / den))
#         power_neg = float(norm.cdf(num_neg / den))
#         return power_pos + power_neg

#     @staticmethod
#     def marginal_variance_delta_hat_prime(sigma_2_posterior, sigmahat_2_delta, scaling_factor) -> float:
#         """
#         Calculates the marginal variance of delta hat prime.

#         Args:
#             sigma_2_posterior: Posterior variance of sigma.
#             sigmahat_2_delta: Variance of delta hat.
#             scaling_factor: multipicative factor for sample size.

#         Returns:
#             The calculated marginal variance.
#         """
#         return sigma_2_posterior + sigmahat_2_delta / scaling_factor

#     @staticmethod
#     def final_posterior_variance(sigma_2_posterior, sigmahat_2_delta, scaling_factor) -> float:
#         """
#         Calculates the final posterior variance.

#         Args:
#             sigma_2_posterior: Posterior variance of effect estimate.
#             sigmahat_2_delta: Frequentist variance of effect estimate.
#             scaling_factor: multipicative factor for sample size.

#         Returns:
#             Posterior variance after the second sample is collected.
#         """
#         prec_prior = 1 / sigma_2_posterior
#         prec_data = 1 / (sigmahat_2_delta / scaling_factor)
#         prec = prec_prior + prec_data
#         return 1 / prec

#     @staticmethod
#     def final_posterior_mean(delta_posterior, sigma_2_posterior, deltahat_t_prime, sigmahat_2_delta, scaling_factor) -> float:
#         v = CalculateRequiredSampleSize.final_posterior_variance(sigma_2_posterior, sigmahat_2_delta, scaling_factor)
#         weighted_mean = delta_posterior / sigma_2_posterior + deltahat_t_prime / (sigmahat_2_delta / scaling_factor)
#         return v * weighted_mean
