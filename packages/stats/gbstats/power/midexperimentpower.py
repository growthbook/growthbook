from typing import Optional
from dataclasses import field
import numpy as np
from pydantic.dataclasses import dataclass
from scipy.stats import norm

from gbstats.models.tests import TestResult, EffectMomentsResult
from gbstats.frequentist.tests import (
    sequential_interval_halfwidth,
)
from gbstats.bayesian.tests import GaussianPrior
from gbstats.models.tests import BaseConfig


@dataclass
class MidExperimentPowerConfig:
    target_power: float = 0.8
    target_mde: float = 0.01
    num_goal_metrics: int = 1
    num_variations: int = 2
    prior_effect: Optional[GaussianPrior] = field(default_factory=GaussianPrior)
    p_value_corrected: bool = False
    sequential: bool = False
    sequential_tuning_parameter: float = 5000


@dataclass
class AdditionalSampleSizeNeededResult:
    additional_users: Optional[float]
    scaling_factor: Optional[float]
    upper_bound_achieved: bool
    update_message: str
    error: Optional[str] = None
    target_power: float = 0.8


@dataclass
class ScalingFactorResult:
    scaling_factor: Optional[float]
    upper_bound_achieved: bool = False
    converged: bool = False
    error: Optional[str] = None


class MidExperimentPower:
    def __init__(
        self,
        effect_moments: EffectMomentsResult,
        test_result: TestResult,
        config: BaseConfig = BaseConfig(),
        power_config: MidExperimentPowerConfig = MidExperimentPowerConfig(),
    ):
        self.effect_moments = effect_moments
        self.relative = config.difference_type == "relative"
        self.test_result = test_result
        self.alpha = config.alpha
        self.num_goal_metrics = power_config.num_goal_metrics
        self.num_tests = (
            (power_config.num_variations - 1) * self.num_goal_metrics
            if power_config.p_value_corrected
            else 1
        )
        self.multiplier = norm.ppf(1 - self.alpha / (2 * self.num_tests))
        self.target_power = power_config.target_power
        self.adjusted_power = self.target_power ** (1 / self.num_goal_metrics)
        self.target_mde = np.abs(power_config.target_mde)
        self.prior_effect = power_config.prior_effect
        self.sequential = power_config.sequential
        self.sequential_tuning_parameter = power_config.sequential_tuning_parameter

    def _default_output(
        self, error_message: Optional[str] = None, update_message: Optional[str] = None
    ) -> AdditionalSampleSizeNeededResult:
        """Return uninformative output when midexperiment power can't be performed."""
        return AdditionalSampleSizeNeededResult(
            error=error_message,
            update_message=update_message if update_message else "error in input",
            additional_users=0,
            scaling_factor=None,
            upper_bound_achieved=False,
            target_power=self.target_power,
        )

    def calculate_sample_size(self) -> AdditionalSampleSizeNeededResult:
        if self.test_result.errorMessage:
            return self._default_output(self.test_result.errorMessage, "unsuccessful")

        scaling_factor_result = self.calculate_scaling_factor()
        if scaling_factor_result.scaling_factor:
            self.additional_users = (
                self.pairwise_sample_size * scaling_factor_result.scaling_factor
            )
        else:
            self.additional_users = None

        if (
            scaling_factor_result.upper_bound_achieved
            and scaling_factor_result.scaling_factor is not None
        ):
            return AdditionalSampleSizeNeededResult(
                error=None,
                update_message="successful, upper bound hit",
                additional_users=self.additional_users,
                scaling_factor=scaling_factor_result.scaling_factor,
                upper_bound_achieved=True,
                target_power=self.target_power,
            )
        if (
            scaling_factor_result.converged
            and scaling_factor_result.scaling_factor is not None
        ):
            return AdditionalSampleSizeNeededResult(
                error=None,
                update_message="successful",
                additional_users=self.additional_users,
                scaling_factor=scaling_factor_result.scaling_factor,
                upper_bound_achieved=False,
                target_power=self.target_power,
            )

        return AdditionalSampleSizeNeededResult(
            error=scaling_factor_result.error,
            update_message="unsuccessful",
            additional_users=None,
            scaling_factor=None,
            upper_bound_achieved=True,
            target_power=self.target_power,
        )

    # case where scaling factor of 0 (i.e., no additional users) is sufficient
    @property
    def already_powered(self) -> bool:
        return self.power(0) > self.adjusted_power

    @property
    def pairwise_sample_size(self) -> int:
        return self.effect_moments.pairwise_sample_size

    # maximum number of iterations for bisection search for power estimation
    @property
    def max_iters(self) -> int:
        return 100

    # maximum number of iterations for finding the scaling factor: 2 ^ 27 = 134,217,728
    @property
    def max_iters_scaling_factor(self) -> int:
        return 27

    @property
    def sigmahat_2_delta(self) -> float:
        if self.test_result.errorMessage is not None:
            return 0
        return self.effect_moments.standard_error**2

    def power(self, scaling_factor) -> float:
        """Calculates the power of a hypothesis test.

        Args:
            mu_prior: The prior mean.
            sigma_2_prior: The prior variance.
            proper: A boolean indicating whether the prior is proper.
            delta: The effect size (difference in means).
            sigma_hat_2: The estimated variance.
            n_t: The sample size of the treatment group.
            scaling_factor: The scaling factor for the control group sample size.
            alpha: The significance level.

        Returns:
            The power of the test.
        """
        n_t_prime = scaling_factor * self.pairwise_sample_size
        adjusted_variance = self.sigmahat_2_delta / (1 + scaling_factor)
        if self.prior_effect and self.prior_effect.proper:
            posterior_precision = 1 / self.prior_effect.variance + 1 / adjusted_variance
            num_1 = adjusted_variance * posterior_precision**0.5 * self.multiplier
            num_2 = (
                adjusted_variance * self.prior_effect.mean / self.prior_effect.variance
            )
            num_3 = self.target_mde
            den = adjusted_variance**0.5
            part_pos = 1 - norm.cdf((num_1 - num_2 - num_3) / den)
            part_neg = norm.cdf(-(num_1 + num_2 + num_3) / den)
        else:
            if self.sequential:
                s2 = self.pairwise_sample_size * self.sigmahat_2_delta
                n_total = self.pairwise_sample_size + n_t_prime
                halfwidth = sequential_interval_halfwidth(
                    s2,
                    n_total,
                    self.sequential_tuning_parameter,
                    self.alpha / self.num_tests,
                )
            else:
                halfwidth = self.multiplier * adjusted_variance**0.5
            part_pos = 1 - norm.cdf(
                (halfwidth - self.target_mde) / adjusted_variance**0.5
            )
            part_neg = norm.cdf(-(halfwidth + self.target_mde) / adjusted_variance**0.5)
        return float(part_pos + part_neg)

    def calculate_scaling_factor(self) -> ScalingFactorResult:
        """Calculates the scaling factor for the control group sample size.

        Args:
            mu_prior: The prior mean.
            sigma_2_prior: The prior variance.
            proper: A boolean indicating whether the prior is proper.
            delta: The effect size (difference in means).
            sigma_hat_2: The estimated variance.
            n_t: The sample size of the treatment group.
            alpha: The significance level.

        Returns:
            The scaling factor.
        """
        # case where this (metric, variation) is ready for decision
        if self.already_powered:
            return ScalingFactorResult(
                converged=True,
                error="",
                upper_bound_achieved=False,
                scaling_factor=0,
            )
        scaling_factor = 1
        current_power = self.power(scaling_factor)
        # First find minimum n_t_prime such that power is greater than 0.8
        for _ in range(self.max_iters_scaling_factor):
            if current_power < self.adjusted_power:
                scaling_factor *= 2
                current_power = self.power(scaling_factor)
            else:
                break
        if current_power < self.adjusted_power:
            return ScalingFactorResult(
                converged=False,
                error="could not find upper bound for scaling factor",
                upper_bound_achieved=True,
                scaling_factor=None,
            )
        # Then perform grid search
        scaling_factor_lower = 0
        scaling_factor_upper = scaling_factor
        diff = current_power - self.adjusted_power
        tolerance = 1e-5  # change to property later
        iteration = 0
        for iteration in range(self.max_iters):  # change max_iters to property later
            if diff > 0:
                scaling_factor_upper = scaling_factor
            else:
                scaling_factor_lower = scaling_factor
            scaling_factor = 0.5 * (scaling_factor_lower + scaling_factor_upper)
            current_power = self.power(scaling_factor)
            diff = current_power - self.adjusted_power
            if abs(diff) < tolerance:
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
