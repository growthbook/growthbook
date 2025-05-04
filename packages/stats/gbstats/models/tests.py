from abc import ABC, abstractmethod
from typing import List, Optional
from pydantic.dataclasses import dataclass
import numpy as np

from gbstats.messages import (
    ZERO_NEGATIVE_VARIANCE_MESSAGE,
    BASELINE_VARIATION_ZERO_MESSAGE,
)

from gbstats.models.statistics import (
    RegressionAdjustedStatistic,
    RegressionAdjustedRatioStatistic,
    RatioStatistic,
    ScaledImpactStatistic,
    TestStatistic,
    compute_theta,
    compute_theta_regression_adjusted_ratio,
)
from gbstats.models.settings import DifferenceType
from gbstats.utils import variance_of_ratios, isinstance_union


# Configs
@dataclass
class EffectMomentsConfig:
    difference_type: DifferenceType = "relative"


@dataclass
class BaseConfig(EffectMomentsConfig):
    traffic_percentage: float = 1
    phase_length_days: float = 1
    total_users: Optional[int] = None
    alpha: float = 0.05


# Results
@dataclass
class EffectMomentsResult:
    stat_a: TestStatistic
    stat_b: TestStatistic
    degrees_of_freedom: float
    unadjusted_baseline_mean: float
    point_estimate: float
    standard_error: float
    scaled_impact_eligible: bool
    error_message: Optional[str]


@dataclass
class Uplift:
    dist: str
    mean: float
    stddev: float


@dataclass
class TestResult:
    expected: float
    ci: List[float]
    uplift: Uplift
    error_message: Optional[str]


@staticmethod
def frequentist_diff(mean_a, mean_b, relative, mean_a_unadjusted=None) -> float:
    if not mean_a_unadjusted:
        mean_a_unadjusted = mean_a
    if relative:
        return (mean_b - mean_a) / mean_a_unadjusted
    else:
        return mean_b - mean_a


@staticmethod
def frequentist_variance(var_a, mean_a, n_a, var_b, mean_b, n_b, relative) -> float:
    if relative:
        return variance_of_ratios(mean_b, var_b / n_b, mean_a, var_a / n_a, 0)
    else:
        return var_b / n_b + var_a / n_a


@staticmethod
def frequentist_variance_relative_cuped(
    stat_a: RegressionAdjustedStatistic, stat_b: RegressionAdjustedStatistic
) -> float:
    den_trt = stat_b.n * stat_a.unadjusted_mean**2
    den_ctrl = stat_a.n * stat_a.unadjusted_mean**2
    if den_trt == 0 or den_ctrl == 0:
        return 0  # avoid division by zero
    theta = stat_a.theta if stat_a.theta else 0
    num_trt = (
        stat_b.post_statistic.variance
        + theta**2 * stat_b.pre_statistic.variance
        - 2 * theta * stat_b.covariance
    )
    v_trt = num_trt / den_trt
    const = -stat_b.post_statistic.mean
    num_a = (
        stat_a.post_statistic.variance * const**2 / (stat_a.post_statistic.mean**2)
    )
    num_b = 2 * theta * stat_a.covariance * const / stat_a.post_statistic.mean
    num_c = theta**2 * stat_a.pre_statistic.variance
    v_ctrl = (num_a + num_b + num_c) / den_ctrl
    return v_trt + v_ctrl


@staticmethod
def frequentist_variance_relative_cuped_ratio(
    stat_a: RegressionAdjustedRatioStatistic, stat_b: RegressionAdjustedRatioStatistic
) -> float:
    if stat_a.unadjusted_mean == 0 or stat_a.d_statistic_post.mean == 0:
        return 0  # avoid division by zero
    g_abs = stat_b.mean - stat_a.mean
    g_rel_den = np.abs(stat_a.unadjusted_mean)
    nabla_ctrl_0_num = -(g_rel_den + g_abs) / stat_a.d_statistic_post.mean
    nabla_ctrl_0_den = g_rel_den**2
    nabla_ctrl_0 = nabla_ctrl_0_num / nabla_ctrl_0_den
    nabla_ctrl_1_num = (
        stat_a.m_statistic_post.mean * g_rel_den / stat_a.d_statistic_post.mean**2
        + stat_a.m_statistic_post.mean * g_abs / stat_a.d_statistic_post.mean**2
    )
    nabla_ctrl_1_den = g_rel_den**2
    nabla_ctrl_1 = nabla_ctrl_1_num / nabla_ctrl_1_den
    nabla_a = np.array(
        [
            nabla_ctrl_0,
            nabla_ctrl_1,
            -stat_a.nabla[2] / g_rel_den,
            -stat_a.nabla[3] / g_rel_den,
        ]
    )
    nabla_b = stat_b.nabla / g_rel_den
    return (
        nabla_a.T.dot(stat_a.lambda_matrix).dot(nabla_a) / stat_a.n
        + nabla_b.T.dot(stat_b.lambda_matrix).dot(nabla_b) / stat_b.n
    )


class EffectMoments:
    def __init__(
        self,
        stat_a: TestStatistic,
        stat_b: TestStatistic,
        config: EffectMomentsConfig = EffectMomentsConfig(),
    ):
        self.stat_a = stat_a
        self.stat_b = stat_b
        self.relative = config.difference_type == "relative"

    def _default_output(
        self,
        error_message: Optional[str] = None,
    ) -> EffectMomentsResult:
        """Return uninformative output when AB test analysis can't be performed
        adequately
        """
        return EffectMomentsResult(
            stat_a=self.stat_a,
            stat_b=self.stat_b,
            degrees_of_freedom=0,
            unadjusted_baseline_mean=self.stat_a.unadjusted_mean,
            point_estimate=0,
            standard_error=0,
            scaled_impact_eligible=False,
            error_message=error_message,
        )

    def _has_zero_variance(self) -> bool:
        """Check if any variance is 0 or negative"""
        return self.stat_a._has_zero_variance or self.stat_b._has_zero_variance

    @property
    def point_estimate(self) -> float:
        return frequentist_diff(
            self.stat_a.mean,
            self.stat_b.mean,
            self.relative,
            self.stat_a.unadjusted_mean,
        )

    @property
    def variance(self) -> float:
        if (
            isinstance(self.stat_a, RegressionAdjustedStatistic)
            and isinstance(self.stat_b, RegressionAdjustedStatistic)
            and self.relative
        ):
            return frequentist_variance_relative_cuped(self.stat_a, self.stat_b)
        elif (
            isinstance(self.stat_a, RegressionAdjustedRatioStatistic)
            and isinstance(self.stat_b, RegressionAdjustedRatioStatistic)
            and self.relative
        ):
            return frequentist_variance_relative_cuped_ratio(self.stat_a, self.stat_b)
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
    def dof(self) -> float:
        # welch-satterthwaite approx
        return pow(
            self.stat_b.variance / self.stat_b.n + self.stat_a.variance / self.stat_a.n,
            2,
        ) / (
            pow(self.stat_b.variance, 2) / (pow(self.stat_b.n, 2) * (self.stat_b.n - 1))
            + pow(self.stat_a.variance, 2)
            / (pow(self.stat_a.n, 2) * (self.stat_a.n - 1))
        )

    @property
    def scaled_impact_eligible(self) -> bool:
        return isinstance_union(self.stat_a, ScaledImpactStatistic)

    def compute_result(self) -> EffectMomentsResult:
        if self._has_zero_variance():
            return self._default_output(ZERO_NEGATIVE_VARIANCE_MESSAGE)
        if self.stat_a.mean == 0:
            return self._default_output(BASELINE_VARIATION_ZERO_MESSAGE)
        if self.stat_a.unadjusted_mean == 0:
            return self._default_output(BASELINE_VARIATION_ZERO_MESSAGE)
        if isinstance(self.stat_a, RegressionAdjustedStatistic):
            if not isinstance(self.stat_b, RegressionAdjustedStatistic):
                return self._default_output(
                    error_message="If stat_a is a RegressionAdjustedStatistic, stat_b must be as well"
                )

        if isinstance(self.stat_b, RegressionAdjustedStatistic):
            if not isinstance(self.stat_a, RegressionAdjustedStatistic):
                return self._default_output(
                    error_message="If stat_b is a RegressionAdjustedStatistic, stat_a must be as well"
                )
        # Ensure theta is set for regression adjusted statistics
        if (
            isinstance(self.stat_b, RegressionAdjustedStatistic)
            and isinstance(self.stat_a, RegressionAdjustedStatistic)
            and (self.stat_a.theta is None or self.stat_b.theta is None)
        ):
            theta = compute_theta(self.stat_a, self.stat_b)
            if theta == 0:
                # revert to non-RA under the hood if no variance in a time period
                self.stat_a = self.stat_a.post_statistic
                self.stat_b = self.stat_b.post_statistic
            else:
                self.stat_a.theta = theta
                self.stat_b.theta = theta
        if (
            isinstance(self.stat_b, RegressionAdjustedRatioStatistic)
            and isinstance(self.stat_a, RegressionAdjustedRatioStatistic)
            and (self.stat_a.theta is None or self.stat_b.theta is None)
        ):
            theta = compute_theta_regression_adjusted_ratio(self.stat_a, self.stat_b)
            if abs(theta) < 1e-8:
                # revert to non-RA under the hood if no variance in a time period
                self.stat_a = RatioStatistic(
                    n=self.stat_a.n,
                    m_statistic=self.stat_a.m_statistic_post,
                    d_statistic=self.stat_a.d_statistic_post,
                    m_d_sum_of_products=self.stat_a.m_post_d_post_sum_of_products,
                )
                self.stat_b = RatioStatistic(
                    n=self.stat_b.n,
                    m_statistic=self.stat_b.m_statistic_post,
                    d_statistic=self.stat_b.d_statistic_post,
                    m_d_sum_of_products=self.stat_b.m_post_d_post_sum_of_products,
                )
            else:
                self.stat_a.theta = theta
                self.stat_b.theta = theta

        return EffectMomentsResult(
            stat_a=self.stat_a,
            stat_b=self.stat_b,
            degrees_of_freedom=self.dof,
            unadjusted_baseline_mean=self.stat_a.unadjusted_mean,
            point_estimate=self.point_estimate,
            standard_error=np.sqrt(self.variance),
            scaled_impact_eligible=self.scaled_impact_eligible,
            error_message=None,
        )


# Tests
class BaseABTest(ABC):
    def __init__(
        self,
        result: EffectMomentsResult,
        config: BaseConfig = BaseConfig(),
    ):
        self.result = result
        self.config = config

    @abstractmethod
    def compute_result(self) -> TestResult:
        pass
