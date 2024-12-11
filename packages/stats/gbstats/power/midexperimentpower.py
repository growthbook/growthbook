from typing import Optional, Tuple

import numpy as np
from pydantic.dataclasses import dataclass
from scipy.stats import norm

from gbstats.models.tests import TestResult
from gbstats.models.statistics import (
    TestStatistic,
)
from gbstats.frequentist.tests import (
    frequentist_variance,
    sequential_interval_halfwidth,
    sequential_rho,
)
from gbstats.models.tests import BaseConfig


@dataclass
class MidExperimentPowerConfig(BaseConfig):
    target_power: float = 0.8
    m_prime: float = 1
    v_prime: float = 1
    sequential: bool = False
    sequential_tuning_parameter: float = 5000


@dataclass
class MidExperimentPowerResult:
    additional_n: Optional[float]
    additional_days: Optional[float]
    update_message: str
    error: Optional[str] = None
    target_power: float = 0.8
    v_prime: float = 1


@dataclass
class ScalingFactorResult:
    scaling_factor: Optional[float]
    converged: bool = False
    error: Optional[str] = None


@dataclass
class PowerParams:
    scaling_factor: float = 1  # multipicative factor for sample size
    delta_posterior: float = 0  # posterior mean
    sigma_2_posterior: float = 1  # posterior variance
    sigmahat_2_delta: float = 1  # frequentist variance
    m_prime: float = 0  # postulated effect size
    v_prime: float = 1  # postulated variance
    alpha: float = 0.05  # significance level
    sequential: bool = False  # whether to adjust for sequential testing
    sequential_tuning_parameter: float = 5000  # tuning parameter for sequential testing
    n_current: int = 1  # first period sample size


class MidExperimentPower:
    def __init__(
        self,
        stat_a: TestStatistic,
        stat_b: TestStatistic,
        test_result: TestResult,
        config: BaseConfig = BaseConfig(),
        power_config: MidExperimentPowerConfig = MidExperimentPowerConfig(),
    ):
        self.stat_a = stat_a
        self.stat_b = stat_b
        self.relative = config.difference_type == "relative"
        self.test_result = test_result
        self.traffic_percentage = config.traffic_percentage
        self.phase_length_days = config.phase_length_days
        self.alpha = config.alpha
        self.z_star = norm.ppf(1 - self.alpha / 2)
        self.target_power = power_config.target_power
        self.m_prime = power_config.m_prime
        self.v_prime = power_config.v_prime
        self.sequential = power_config.sequential
        self.sequential_tuning_parameter = power_config.sequential_tuning_parameter

    def calculate_sample_size(self) -> MidExperimentPowerResult:
        if self.already_significant:
            return MidExperimentPowerResult(
                error=None,
                update_message="already significant",
                additional_n=0,
                additional_days=0,
                target_power=self.target_power,
            )
        else:
            scaling_factor_result = self.find_scaling_factor()
            if scaling_factor_result.converged and scaling_factor_result.scaling_factor:
                self.additional_n = (
                    self.pairwise_sample_size * scaling_factor_result.scaling_factor
                )
                daily_traffic = self.pairwise_sample_size / self.phase_length_days
                self.additional_days = self.additional_n / daily_traffic
                return MidExperimentPowerResult(
                    error=None,
                    update_message="successful",
                    v_prime=self.sigmahat_2_delta
                    / scaling_factor_result.scaling_factor,
                    additional_n=self.additional_n,
                    additional_days=self.additional_days,
                    target_power=self.target_power,
                )
            else:
                return MidExperimentPowerResult(
                    error=scaling_factor_result.error,
                    update_message="unsuccessful",
                    v_prime=0,
                    additional_n=0,
                    additional_days=0,
                    target_power=self.target_power,
                )

    @property
    def already_significant(self) -> bool:
        return (
            np.abs(self.test_result.uplift.mean) / self.test_result.uplift.stddev
            > self.z_star
        )

    @property
    def pairwise_sample_size(self) -> int:
        return self.stat_a.n + self.stat_b.n

    # maximum number of iterations for bisection search for power estimation
    @property
    def max_iters(self) -> int:
        return 100

    # maximum number of iterations for finding the scaling factor
    @property
    def max_iters_scaling_factor(self) -> int:
        return 25

    @property
    def delta_posterior(self) -> float:
        return self.test_result.expected

    @property
    def sigma_2_posterior(self) -> float:
        return self.test_result.uplift.stddev**2

    @property
    def sigmahat_2_delta(self) -> float:
        return frequentist_variance(
            self.stat_a.variance,
            self.stat_a.unadjusted_mean,
            self.stat_a.n,
            self.stat_b.variance,
            self.stat_b.unadjusted_mean,
            self.stat_b.n,
            self.relative,
        )

    def find_scaling_factor_bound(self, upper=True) -> Tuple[float, bool]:
        """
        Finds the lower bound for the scaling factor.

        Args:
            delta_posterior: A delta posterior value.
            sigma_2_posterior: A posterior variance.
            sigmahat_2_delta: A delta variance.

        Returns:
            The lower bound for the scaling factor.
        """
        scaling_factor = 1
        power_params = PowerParams(
            scaling_factor=scaling_factor,
            delta_posterior=self.delta_posterior,
            sigma_2_posterior=self.sigma_2_posterior,
            sigmahat_2_delta=self.sigmahat_2_delta,
            m_prime=self.m_prime,
            v_prime=self.sigmahat_2_delta / scaling_factor,
            alpha=self.alpha,
            sequential=self.sequential,
            sequential_tuning_parameter=self.sequential_tuning_parameter,
            n_current=self.pairwise_sample_size,
        )
        current_power = self.calculate_power(power_params)
        converged = False
        multiplier = 2 if upper else 0.5
        iteration = 0
        for iteration in range(self.max_iters_scaling_factor):
            scaling_factor *= multiplier
            power_params.scaling_factor = scaling_factor
            power_params.v_prime = self.sigmahat_2_delta / scaling_factor
            current_power = self.calculate_power(power_params)
            if upper and current_power > self.target_power:
                break
            if not upper and current_power < self.target_power:
                break
        if iteration < self.max_iters_scaling_factor - 1:
            converged = True
        return scaling_factor, converged

    @staticmethod
    def calculate_power(power_params: PowerParams) -> float:
        """
        Args:
            scaling_factor: multipicative factor for sample size.
            delta_posterior: posterior mean.
            sigma_2_posterior: posterior variance.
            sigmahat_2_delta: frequentist variance.
            m_prime: postulated effect size.
            v_prime: postulated variance.
            alpha: significance level.
            sequential: whether to adjust for sequential testing.
            sequential_tuning_parameter: tuning parameter for sequential testing.
            n: first period sample size

        Returns:
            power estimate.
        """
        scaling_factor = power_params.scaling_factor
        delta_posterior = power_params.delta_posterior
        sigma_2_posterior = power_params.sigma_2_posterior
        sigmahat_2_delta = power_params.sigmahat_2_delta
        m_prime = power_params.m_prime
        v_prime = power_params.v_prime
        alpha = power_params.alpha
        sequential = power_params.sequential
        sequential_tuning_parameter = power_params.sequential_tuning_parameter
        n_current = power_params.n_current

        if sequential:
            rho = sequential_rho(alpha, sequential_tuning_parameter)
            s2 = sigmahat_2_delta * n_current
            n_total = n_current * (1 + scaling_factor)
            halfwidth = sequential_interval_halfwidth(s2, n_total, rho, alpha)
        else:
            z_star = float(norm.ppf(1 - alpha / 2))
            v = MidExperimentPower.final_posterior_variance(
                sigma_2_posterior, sigmahat_2_delta, scaling_factor
            )
            s = np.sqrt(v)
            halfwidth = z_star * s
        marginal_var = MidExperimentPower.marginal_variance_delta_hat_prime(
            sigma_2_posterior, sigmahat_2_delta, scaling_factor
        )
        num_1 = halfwidth * marginal_var / sigma_2_posterior
        num_2 = (
            (sigmahat_2_delta / scaling_factor) * delta_posterior / sigma_2_posterior
        )
        num_3 = m_prime
        den = np.sqrt(v_prime)
        num_pos = num_1 - num_2 - num_3
        num_neg = -num_1 - num_2 - num_3
        power_pos = float(1 - norm.cdf(num_pos / den))
        power_neg = float(norm.cdf(num_neg / den))
        return power_pos + power_neg
        # return power_pos

    def find_scaling_factor(self) -> ScalingFactorResult:
        scaling_factor = 1
        power_params = PowerParams(
            scaling_factor=scaling_factor,
            delta_posterior=self.delta_posterior,
            sigma_2_posterior=self.sigma_2_posterior,
            sigmahat_2_delta=self.sigmahat_2_delta,
            m_prime=self.m_prime,
            v_prime=self.sigmahat_2_delta / scaling_factor,
            alpha=self.alpha,
            sequential=self.sequential,
            sequential_tuning_parameter=self.sequential_tuning_parameter,
            n_current=self.pairwise_sample_size,
        )
        current_power = self.calculate_power(power_params)
        scaling_factor_lower, converged_lower = self.find_scaling_factor_bound(
            upper=False
        )
        if not converged_lower:
            return ScalingFactorResult(
                converged=False,
                error="could not find lower bound for scaling factor",
                scaling_factor=None,
            )
        scaling_factor_upper, converged_upper = self.find_scaling_factor_bound(
            upper=True
        )
        if not converged_upper:
            return ScalingFactorResult(
                converged=False,
                error="upper bound for scaling factor is greater than "
                + str(2**self.max_iters_scaling_factor),
                scaling_factor=None,
            )
        diff = current_power - 0.8
        iteration = 0
        for iteration in range(self.max_iters):
            if diff < 0:
                scaling_factor_lower = scaling_factor
            else:
                scaling_factor_upper = scaling_factor
            scaling_factor = 0.5 * (scaling_factor_lower + scaling_factor_upper)
            power_params.scaling_factor = scaling_factor
            power_params.v_prime = self.sigmahat_2_delta / scaling_factor
            current_power = self.calculate_power(power_params)
            diff = current_power - 0.8
            if abs(diff) < 1e-3:
                break

        converged = iteration < self.max_iters - 1
        error = "" if converged else "bisection search did not converge"
        return ScalingFactorResult(
            converged=converged, error=error, scaling_factor=scaling_factor
        )

    @staticmethod
    def marginal_variance_delta_hat_prime(
        sigma_2_posterior, sigmahat_2_delta, scaling_factor
    ) -> float:
        """
        Calculates the marginal variance of delta hat prime.

        Args:
            sigma_2_posterior: Posterior variance of sigma.
            sigmahat_2_delta: Variance of delta hat.
            scaling_factor: multipicative factor for sample size.

        Returns:
            The calculated marginal variance.
        """
        return sigma_2_posterior + sigmahat_2_delta / scaling_factor

    @staticmethod
    def final_posterior_variance(
        sigma_2_posterior, sigmahat_2_delta, scaling_factor
    ) -> float:
        """
        Calculates the final posterior variance.

        Args:
            sigma_2_posterior: Posterior variance of effect estimate.
            sigmahat_2_delta: Frequentist variance of effect estimate.
            scaling_factor: multipicative factor for sample size.

        Returns:
            Posterior variance after the second sample is collected.
        """
        prec_prior = 1 / sigma_2_posterior
        prec_data = 1 / (sigmahat_2_delta / scaling_factor)
        prec = prec_prior + prec_data
        return 1 / prec

    @staticmethod
    def final_posterior_mean(
        delta_posterior,
        sigma_2_posterior,
        deltahat_t_prime,
        sigmahat_2_delta,
        scaling_factor,
    ) -> float:
        v = MidExperimentPower.final_posterior_variance(
            sigma_2_posterior, sigmahat_2_delta, scaling_factor
        )
        weighted_mean = delta_posterior / sigma_2_posterior + deltahat_t_prime / (
            sigmahat_2_delta / scaling_factor
        )
        return v * weighted_mean
