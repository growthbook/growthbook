from abc import ABC, abstractmethod
from typing import List, Optional, Tuple, Literal
from pydantic.dataclasses import dataclass
import numpy as np
import operator
from functools import reduce


from gbstats.messages import (
    ZERO_NEGATIVE_VARIANCE_MESSAGE,
    BASELINE_VARIATION_ZERO_MESSAGE,
)

from gbstats.models.statistics import (
    RegressionAdjustedStatistic,
    RegressionAdjustedRatioStatistic,
    RatioStatistic,
    ScaledImpactStatistic,
    SummableStatistic,
    TestStatistic,
    compute_theta,
    compute_theta_regression_adjusted_ratio,
)
from gbstats.models.settings import DifferenceType
from gbstats.utils import isinstance_union, frequentist_diff, frequentist_variance


# Configs
@dataclass
class EffectMomentsConfig:
    difference_type: Literal["relative", "absolute"] = "relative"


@dataclass
class BaseConfig:
    difference_type: DifferenceType = "relative"
    traffic_percentage: float = 1
    phase_length_days: float = 1
    total_users: Optional[int] = None
    alpha: float = 0.05
    post_stratify: bool = False


# Results
@dataclass
class EffectMomentsResult:
    point_estimate: float
    standard_error: float
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


def frequentist_variance_all_cases(
    stat_a: TestStatistic, stat_b: TestStatistic, relative: bool
) -> float:
    if (
        isinstance(stat_a, RegressionAdjustedStatistic)
        and isinstance(stat_b, RegressionAdjustedStatistic)
        and relative
    ):
        return frequentist_variance_relative_cuped(stat_a, stat_b)
    elif (
        isinstance(stat_a, RegressionAdjustedRatioStatistic)
        and isinstance(stat_b, RegressionAdjustedRatioStatistic)
        and relative
    ):
        return frequentist_variance_relative_cuped_ratio(stat_a, stat_b)
    else:
        return frequentist_variance(
            stat_a.variance,
            stat_a.unadjusted_mean,
            stat_a.n,
            stat_b.variance,
            stat_b.unadjusted_mean,
            stat_b.n,
            relative,
        )


class EffectMoments:
    def __init__(
        self,
        stats: List[Tuple[TestStatistic, TestStatistic]],
        config: EffectMomentsConfig = EffectMomentsConfig(),
    ):
        self.stat_a, self.stat_b = sum_stats(stats)
        self.relative = config.difference_type == "relative"

    def _default_output(
        self,
        error_message: Optional[str] = None,
    ) -> EffectMomentsResult:
        """Return uninformative output when AB test analysis can't be performed
        adequately
        """
        return EffectMomentsResult(
            point_estimate=0,
            standard_error=0,
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
        return frequentist_variance_all_cases(self.stat_a, self.stat_b, self.relative)

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
            point_estimate=self.point_estimate,
            standard_error=np.sqrt(self.variance),
            error_message=None,
        )


def sum_stats(
    stats: List[Tuple[TestStatistic, TestStatistic]]
) -> Tuple[TestStatistic, TestStatistic]:
    stats_a, stats_b = zip(*stats)
    summable_check_a = all(isinstance(stat_a, SummableStatistic) for stat_a in stats_a)
    summable_check_b = all(isinstance(stat_b, SummableStatistic) for stat_b in stats_b)
    if len(stats_a) > 1 and (not summable_check_a or not summable_check_b):
        raise ValueError("Non-summable statistics must be of length one.")
    stat_a = reduce(operator.add, stats_a)
    stat_b = reduce(operator.add, stats_b)
    return stat_a, stat_b


# Tests
class BaseABTest(ABC):
    def __init__(
        self,
        stats: List[Tuple[TestStatistic, TestStatistic]],
        config: BaseConfig = BaseConfig(),
    ):
        self.stats = stats
        self.stat_a, self.stat_b = sum_stats(self.stats)
        self.config = config
        self.alpha = config.alpha
        self.relative = config.difference_type == "relative"
        self.scaled = config.difference_type == "scaled"
        self.traffic_percentage = config.traffic_percentage
        self.total_users = config.total_users
        self.phase_length_days = config.phase_length_days
        self.moments_result = self.compute_moments_result()

    def compute_moments_result(self) -> EffectMomentsResult:
        if self.config.post_stratify:
            raise NotImplementedError("Post-stratification not implemented")
        else:
            return EffectMoments(
                self.stats,
                EffectMomentsConfig(
                    difference_type="relative" if self.relative else "absolute"
                ),
            ).compute_result()

    @property
    def n(self) -> int:
        return self.stat_a.n + self.stat_b.n

    @property
    def scaled_impact_eligible(self) -> bool:
        return isinstance_union(
            self.stat_a, ScaledImpactStatistic
        ) and isinstance_union(self.stat_b, ScaledImpactStatistic)

    @abstractmethod
    def compute_result(self) -> TestResult:
        pass
