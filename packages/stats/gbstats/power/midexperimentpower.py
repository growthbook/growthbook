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
from gbstats.utils import is_statistically_significant

from gbstats.messages import (
    ZERO_NEGATIVE_VARIANCE_MESSAGE,
    BASELINE_VARIATION_ZERO_MESSAGE,
)


@dataclass
class MidExperimentPowerConfig(BaseConfig):
    target_power: float = 0.8
    m_prime: float = 1
    v_prime: Optional[float] = None
    sequential: bool = False
    sequential_tuning_parameter: float = 5000
    num_goal_metrics: int = 1
    num_variations: int = 2


@dataclass
class AdditionalSampleSizeNeededResult:
    additional_users: Optional[float]
    scaling_factor: Optional[float]
    upper_bound_achieved: bool
    update_message: str
    error: Optional[str] = None
    target_power: float = 0.8
    v_prime: Optional[float] = None


@dataclass
class ScalingFactorResult:
    scaling_factor: Optional[float]
    upper_bound_achieved: bool = False
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
    sequential: bool = False  # whether to adjust for sequential testings
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
        self.alpha = config.alpha
        self.num_goal_metrics = power_config.num_goal_metrics
        self.num_tests = (power_config.num_variations - 1) * self.num_goal_metrics
        self.z_star = norm.ppf(1 - self.alpha / (2 * self.num_tests))
        self.target_power = power_config.target_power
        self.m_prime = power_config.m_prime
        self.v_prime = (
            power_config.v_prime if power_config.v_prime else self.sigmahat_2_delta
        )
        self.sequential = power_config.sequential
        self.sequential_tuning_parameter = power_config.sequential_tuning_parameter

    def _has_zero_variance(self) -> bool:
        """Check if any variance is 0 or negative"""
        return self.stat_a._has_zero_variance or self.stat_b._has_zero_variance

    def _control_mean_zero(self) -> bool:
        return self.stat_a.mean == 0

    def _default_output(
        self, error_message: Optional[str] = None, update_message: Optional[str] = None
    ) -> AdditionalSampleSizeNeededResult:
        """Return uninformative output when midexperiment power can't be performed."""
        return AdditionalSampleSizeNeededResult(
            error=error_message,
            update_message="error in input",
            additional_users=0,
            scaling_factor=0,
            upper_bound_achieved=False,
            target_power=self.target_power,
            v_prime=None,
        )

    def calculate_sample_size(self) -> AdditionalSampleSizeNeededResult:
        if self.test_result.error_message:
            return self._default_output(self.test_result.error_message, "unsuccessful")
        if self._control_mean_zero():
            return self._default_output(BASELINE_VARIATION_ZERO_MESSAGE, "unsuccessful")
        elif self._has_zero_variance():
            return self._default_output(ZERO_NEGATIVE_VARIANCE_MESSAGE, "unsuccessful")
        elif self.already_significant:
            return self._default_output(None, "already significant")
        else:
            scaling_factor_result = self.find_scaling_factor()
            if scaling_factor_result.scaling_factor:
                self.additional_users = (
                    self.pairwise_sample_size * scaling_factor_result.scaling_factor
                )
            else:
                self.additional_users = None
            if scaling_factor_result.upper_bound_achieved:
                if scaling_factor_result.scaling_factor:
                    return AdditionalSampleSizeNeededResult(
                        error=None,
                        update_message="successful, upper bound hit",
                        v_prime=self.sigmahat_2_delta
                        / scaling_factor_result.scaling_factor,
                        additional_users=self.additional_users,
                        scaling_factor=scaling_factor_result.scaling_factor,
                        upper_bound_achieved=True,
                        target_power=self.target_power,
                    )
                else:
                    return AdditionalSampleSizeNeededResult(
                        error=scaling_factor_result.error,
                        update_message="unsuccessful",
                        v_prime=self.sigmahat_2_delta,
                        additional_users=None,
                        scaling_factor=None,
                        upper_bound_achieved=True,
                        target_power=self.target_power,
                    )
            if scaling_factor_result.converged and scaling_factor_result.scaling_factor:
                return AdditionalSampleSizeNeededResult(
                    error=None,
                    update_message="successful",
                    v_prime=self.sigmahat_2_delta
                    / scaling_factor_result.scaling_factor,
                    additional_users=self.additional_users,
                    scaling_factor=scaling_factor_result.scaling_factor,
                    upper_bound_achieved=False,
                    target_power=self.target_power,
                )
            else:
                return AdditionalSampleSizeNeededResult(
                    error=scaling_factor_result.error,
                    update_message="unsuccessful",
                    v_prime=self.sigmahat_2_delta,
                    additional_users=None,
                    scaling_factor=None,
                    upper_bound_achieved=False,
                    target_power=self.target_power,
                )

    @property
    def already_significant(self) -> bool:
        return is_statistically_significant(self.test_result.ci)

    @property
    def pairwise_sample_size(self) -> int:
        return self.stat_a.n + self.stat_b.n

    # maximum number of iterations for bisection search for power estimation
    @property
    def max_iters(self) -> int:
        return 100

    # maximum number of iterations for finding the scaling factor: 2 ^ 27 = 134,217,728
    @property
    def max_iters_scaling_factor(self) -> int:
        return 27

    @property
    def max_scaling_factor(self) -> float:
        return 2**self.max_iters_scaling_factor

    @property
    def delta_posterior(self) -> float:
        return self.test_result.expected

    @property
    def sigma_2_posterior(self) -> float:
        return self.test_result.uplift.stddev**2

    @property
    def sigmahat_2_delta(self) -> float:
        if self._has_zero_variance() or self._control_mean_zero():
            return 0
        else:
            return frequentist_variance(
                self.stat_a.variance,
                self.stat_a.unadjusted_mean,
                self.stat_a.n,
                self.stat_b.variance,
                self.stat_b.unadjusted_mean,
                self.stat_b.n,
                self.relative,
            )

    @property
    def adjusted_power(self) -> float:
        return self.target_power ** (1 / self.num_goal_metrics)

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
        current_power = self.calculate_power(
            power_params.scaling_factor, power_params.m_prime, power_params.v_prime
        )
        converged = False
        multiplier = 2 if upper else 0.5
        iteration = 0
        for iteration in range(self.max_iters_scaling_factor):
            scaling_factor *= multiplier
            power_params.scaling_factor = scaling_factor
            power_params.v_prime = self.sigmahat_2_delta / scaling_factor
            current_power = self.calculate_power(
                power_params.scaling_factor, power_params.m_prime, power_params.v_prime
            )
            if upper and current_power > self.adjusted_power:
                break
            if not upper and current_power < self.adjusted_power:
                break
        if iteration < self.max_iters_scaling_factor - 1:
            converged = True
        return scaling_factor, converged

    def calculate_power(
        self, scaling_factor: float, m_prime: float, v_prime: float
    ) -> float:
        """
        Args:
            scaling_factor: multipicative factor for sample size.
            m_prime: postulated effect size.
            v_prime: postulated variance.

        Returns:
            power estimate.
        """
        if self.sequential:
            rho = sequential_rho(
                self.alpha / self.num_tests, self.sequential_tuning_parameter
            )
            s2 = self.sigmahat_2_delta * self.pairwise_sample_size
            n_total = self.pairwise_sample_size * (1 + scaling_factor)
            halfwidth = sequential_interval_halfwidth(
                s2, n_total, rho, self.alpha / self.num_tests
            )
        else:
            v = MidExperimentPower.final_posterior_variance(
                self.sigma_2_posterior, self.sigmahat_2_delta, scaling_factor
            )
            s = np.sqrt(v)
            halfwidth = self.z_star * s
        marginal_var = MidExperimentPower.marginal_variance_delta_hat_prime(
            self.sigma_2_posterior, self.sigmahat_2_delta, scaling_factor
        )
        num_1 = halfwidth * marginal_var / self.sigma_2_posterior
        num_2 = (
            (self.sigmahat_2_delta / scaling_factor)
            * self.delta_posterior
            / self.sigma_2_posterior
        )
        num_3 = m_prime
        den = np.sqrt(v_prime)
        num_pos = num_1 - num_2 - num_3
        num_neg = -num_1 - num_2 - num_3
        power_pos = float(1 - norm.cdf(num_pos / den))
        power_neg = float(norm.cdf(num_neg / den))
        return power_pos + power_neg

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
        current_power = self.calculate_power(
            power_params.scaling_factor, power_params.m_prime, power_params.v_prime
        )
        scaling_factor_lower, converged_lower = self.find_scaling_factor_bound(
            upper=False
        )
        if not converged_lower:
            return ScalingFactorResult(
                converged=False,
                error="could not find lower bound for scaling factor",
                upper_bound_achieved=False,
                scaling_factor=None,
            )
        scaling_factor_upper, converged_upper = self.find_scaling_factor_bound(
            upper=True
        )
        if not converged_upper:
            return ScalingFactorResult(
                converged=False,
                error="",
                upper_bound_achieved=True,
                scaling_factor=self.max_scaling_factor,
            )
        diff = current_power - self.adjusted_power
        iteration = 0
        for iteration in range(self.max_iters):
            if diff < 0:
                scaling_factor_lower = scaling_factor
            else:
                scaling_factor_upper = scaling_factor
            scaling_factor = 0.5 * (scaling_factor_lower + scaling_factor_upper)
            power_params.scaling_factor = scaling_factor
            power_params.v_prime = self.sigmahat_2_delta / scaling_factor
            current_power = self.calculate_power(
                power_params.scaling_factor, power_params.m_prime, power_params.v_prime
            )
            diff = current_power - self.adjusted_power
            if abs(diff) < 1e-3:
                break

        converged = iteration < self.max_iters - 1

        error = "" if converged else "bisection search did not converge"

        if error:
            raise ValueError(
                [
                    current_power,
                    self.adjusted_power,
                    diff,
                    scaling_factor,
                    scaling_factor_lower,
                    scaling_factor_upper,
                ]
            )

        return ScalingFactorResult(
            converged=converged,
            error=error,
            scaling_factor=scaling_factor,
            upper_bound_achieved=False,
        )

    @staticmethod
    def marginal_variance_delta_hat_prime(
        sigma_2_posterior: float, sigmahat_2_delta: float, scaling_factor: float
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
