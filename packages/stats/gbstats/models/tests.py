from abc import ABC, abstractmethod
from typing import List, Optional, Tuple, Literal, Union
from pydantic.dataclasses import dataclass
from dataclasses import dataclass as dataclass_with_arbitrary_types_allowed

import numpy as np
import operator
from functools import reduce
from gbstats.utils import multinomial_covariance


from gbstats.messages import (
    ZERO_NEGATIVE_VARIANCE_MESSAGE,
    BASELINE_VARIATION_ZERO_MESSAGE,
)

from gbstats.models.statistics import (
    ProportionStatistic,
    SampleMeanStatistic,
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
    pairwise_sample_size: int


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
    num_a = stat_a.post_statistic.variance * const**2 / (stat_a.post_statistic.mean**2)
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
            pairwise_sample_size=0,
            error_message=error_message,
        )

    def _has_zero_variance(self) -> bool:
        """Check if any variance is 0 or negative"""
        return (
            self.stat_a._has_zero_variance
            or self.stat_b._has_zero_variance
            or self.variance <= 0
        )

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

        return EffectMomentsResult(
            point_estimate=self.point_estimate,
            standard_error=np.sqrt(self.variance),
            pairwise_sample_size=self.stat_a.n + self.stat_b.n,
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
    if len(stats_a) == 1:
        return stats_a[0], stats_b[0]
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
        self.initialize_theta()
        self.config = config
        self.alpha = config.alpha
        self.relative = config.difference_type == "relative"
        self.scaled = config.difference_type == "scaled"
        self.traffic_percentage = config.traffic_percentage
        self.total_users = config.total_users
        self.phase_length_days = config.phase_length_days
        self.moments_result = self.compute_moments_result()

    def initialize_theta(self) -> None:
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

    def compute_moments_result(self) -> EffectMomentsResult:
        moments_config = EffectMomentsConfig(
            difference_type="relative" if self.relative else "absolute"
        )
        if self.config.post_stratify:
            return EffectMomentsPostStratification(self.stats, moments_config).compute_result()

        else:
            return EffectMoments(
                self.stats,
                moments_config,
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

@dataclass
class StrataResultCount:
    n: int
    effect: float
    control_mean: float
    effect_cov: float
    control_mean_cov: float
    effect_control_mean_cov: float

@dataclass
class StrataResultRatio:
    n: int
    numerator_effect: float
    numerator_control_mean: float
    denominator_effect: float
    denominator_control_mean: float
    numerator_effect_cov: float
    numerator_control_mean_cov: float
    denominator_effect_cov: float
    denominator_control_mean_cov: float
    numerator_effect_numerator_control_mean_cov: float
    numerator_effect_denominator_effect_cov: float
    numerator_effect_denominator_control_mean_cov: float
    numerator_control_mean_denominator_effect_cov: float
    numerator_control_mean_denominator_control_mean_cov: float
    denominator_effect_denominator_control_mean_cov: float


class CreateStrataResultBase(ABC):
    def __init__(self, stat_a: TestStatistic, stat_b: TestStatistic):
        self.stat_a = stat_a
        self.stat_b = stat_b

    @property
    def n_a(self) -> int:
        return self.stat_a.n

    @property
    def n_b(self) -> int:
        return self.stat_b.n

    @property
    def n(self) -> int:
        return self.n_a + self.n_b

    @property
    @abstractmethod
    def regression_coefs(self) -> np.ndarray:
        pass

    @property
    @abstractmethod
    def len_alpha(self) -> int:
        """
        Number of alpha parameters
        # 1 for count
        # 2 for count CUPED
        # 2 for ratio
        # 4 for ratio CUPED
        """
        pass

    @property
    @abstractmethod
    def contrast_matrix(self) -> np.ndarray:
        pass

    @property
    def mean(self) -> np.ndarray:
        return self.contrast_matrix.dot(self.regression_coefs).ravel()

    @property
    @abstractmethod
    def covariance(self) -> np.ndarray:
        pass
    
    @abstractmethod
    def compute_result(self) -> Union[StrataResultCount, StrataResultRatio]:
        pass



# Algorithm 1 for count metrics
class CreateStrataResult(CreateStrataResultBase):
    def __init__(
        self,
        stat_a: Union[ProportionStatistic, SampleMeanStatistic],
        stat_b: Union[ProportionStatistic, SampleMeanStatistic],
    ):
        self.stat_a = stat_a
        self.stat_b = stat_b

    @property
    def len_alpha(self) -> int:
        return 1

    @property
    def regression_coefs(self) -> np.ndarray:
        return np.array([self.stat_b.mean, self.stat_a.mean])
    
    @staticmethod
    def compute_regression_coefs_covariance(len_alpha: int, n: int, n_a: int, n_b: int, lambda_a: np.ndarray, lambda_b: np.ndarray) -> np.ndarray:
        nrow_v = 2 * len_alpha
        v = np.zeros((nrow_v, nrow_v))
        v[0 : len_alpha, 0 : len_alpha] = lambda_b * n / n_b
        v[
            len_alpha : (2 * len_alpha), len_alpha : (2 * len_alpha)
        ] = (lambda_a * n / n_a)
        return v
        
    @property
    def regression_coefs_covariance(self) -> np.ndarray:
        return self.compute_regression_coefs_covariance(self.len_alpha, self.n, self.n_a, self.n_b, self.lambda_a, self.lambda_b)

    @property
    def lambda_a(self) -> np.ndarray:
        return np.array([self.stat_a.variance])

    @property
    def lambda_b(self) -> np.ndarray:
        return np.array([self.stat_b.variance])

    @property
    def contrast_matrix(self) -> np.ndarray:
        return np.array([[0, 1], [1, -1]])
    
    @staticmethod
    def covariance_unadjusted(contrast_matrix: np.ndarray, regression_coefs_covariance: np.ndarray) -> np.ndarray:
        return contrast_matrix.dot(regression_coefs_covariance).dot(contrast_matrix.T)
    
    @property
    def covariance(self) -> np.ndarray:
        return self.covariance_unadjusted(self.contrast_matrix, self.regression_coefs_covariance)
    
    def compute_result(self) -> StrataResultCount:
        return StrataResultCount(
            n=self.n, 
            effect=self.mean[0],
            effect_cov=self.covariance[0, 0],
            control_mean=self.mean[1],
            control_mean_cov=self.covariance[1, 1],
            effect_control_mean_cov=self.covariance[0, 1],
        )


# Regression version of Algorithm 1 for count metrics
class CreateStrataResultRegressionAdjusted(CreateStrataResultBase):
    def __init__(
        self,
        stat_a: RegressionAdjustedStatistic,
        stat_b: RegressionAdjustedStatistic,
        theta: Optional[float] = None,
    ):
        self.stat_a = stat_a
        self.stat_b = stat_b
        self.theta = theta

    @property
    def n(self) -> int:
        return self.n_a + self.n_b

    @property
    def len_alpha(self) -> int:
        return 2

    @property
    def len_gamma(self) -> int:
        return 3

    @property
    def xtx(self) -> np.ndarray:
        xtx = np.zeros((self.len_gamma, self.len_gamma))
        xtx[0, 0] = self.n_a + self.n_b
        xtx[1, 1] = self.n_b
        xtx[2, 2] = (
            self.stat_a.pre_statistic.sum_squares
            + self.stat_b.pre_statistic.sum_squares
        )
        xtx[0, 1] = xtx[1, 0] = xtx[1, 1]
        xtx[0, 2] = xtx[2, 0] = (
            self.stat_a.pre_statistic.sum + self.stat_b.pre_statistic.sum
        )
        xtx[1, 2] = xtx[2, 1] = self.stat_b.pre_statistic.sum
        return xtx

    @property
    def xtx_inv(self) -> np.ndarray:
        return np.linalg.inv(self.xtx)

    @property
    def xty(self) -> np.ndarray:
        xty = np.zeros((self.len_gamma, 1))
        xty[0] = self.stat_a.post_statistic.sum + self.stat_b.post_statistic.sum
        xty[1] = self.stat_b.post_statistic.sum
        xty[2] = (
            self.stat_a.post_pre_sum_of_products + self.stat_b.post_pre_sum_of_products
        )
        return xty

    @property
    def regression_coefs(self) -> np.ndarray:
        return self.xtx_inv.dot(self.xty)

    # covariance matrix, 1 x 1 in this case
    @property
    def sigma(self) -> np.ndarray:
        resids_part_1 = (
            self.stat_a.post_statistic.sum_squares
            + self.stat_b.post_statistic.sum_squares
        )
        resids_part_2 = -self.xty.T.dot(self.xtx_inv).dot(self.xty)
        return np.array((resids_part_1 + resids_part_2) / (self.n - 3))

    @property
    def baseline_mean(self) -> float:
        statistic_pre = self.stat_a.pre_statistic + self.stat_b.pre_statistic
        return statistic_pre.mean

    @property
    def baseline_variance(self) -> float:
        statistic_pre = self.stat_a.pre_statistic + self.stat_b.pre_statistic
        return statistic_pre.variance

    @staticmethod
    def contrast_matrix_estimated_mean(contrast_matrix: np.ndarray, i: int) -> np.ndarray:
        return np.expand_dims(contrast_matrix[i, :], axis=1)

    @staticmethod
    def contrast_matrix_covariance(len_gamma: int, n: int, baseline_variance: float, i: int, j: int) -> np.ndarray:
        v = np.zeros((len_gamma, len_gamma))
        if i == 0 and j == 0:
            v[2, 2] = baseline_variance / n
        return v

    @staticmethod
    def contrast_matrix_second_moment(contrast_matrix: np.ndarray, len_gamma: int, n: int, baseline_variance: float, i: int, j: int) -> np.ndarray:
        m_i = CreateStrataResultRegressionAdjusted.contrast_matrix_estimated_mean(contrast_matrix, i)
        m_j = CreateStrataResultRegressionAdjusted.contrast_matrix_estimated_mean(contrast_matrix, j)
        return CreateStrataResultRegressionAdjusted.contrast_matrix_covariance(len_gamma, n, baseline_variance, i, j) + m_i.dot(m_j.T)

    @property
    def contrast_matrix(self) -> np.ndarray:
        m = np.zeros((2, 3))
        m[0, :] = [1, 0, self.baseline_mean]
        m[1, :] = [0, 1, 0]
        return m

    @property
    def mean(self) -> np.ndarray:
        return self.contrast_matrix.dot(self.regression_coefs).ravel()
    
    @staticmethod
    def create_coef_covariance(sigma: np.ndarray, xtx_inv: np.ndarray) -> np.ndarray:
        return np.kron(sigma, xtx_inv)

    @property
    def coef_covariance(self) -> np.ndarray:
        return self.create_coef_covariance(self.sigma, self.xtx_inv)
    
    @staticmethod
    def covariance_adjusted(n: int, coef_covariance: np.ndarray, contrast_matrix: np.ndarray, regression_coefs: np.ndarray, baseline_variance: float) -> np.ndarray:
        len_alpha = contrast_matrix.shape[0]
        len_gamma = regression_coefs.shape[0]
        v_alpha = np.zeros((len_alpha, len_alpha))
        for i in range(len_alpha):
            for j in range(i + 1):
                sum_1 = sum(
                    np.diag(
                        coef_covariance.dot(CreateStrataResultRegressionAdjusted.contrast_matrix_second_moment(contrast_matrix, len_gamma, n, baseline_variance, i, j))
                    )   
                )
                sum_2 = sum(
                    np.diag(
                        regression_coefs.dot(regression_coefs.T).dot(CreateStrataResultRegressionAdjusted.contrast_matrix_covariance(len_gamma, n, baseline_variance, i, j)))
                )
                v_alpha[i, j] = sum_1 + sum_2
                v_alpha[j, i] = v_alpha[i, j]
        return float(n) * v_alpha

    @property
    def covariance(self) -> np.ndarray:
        return self.covariance_adjusted(self.n, self.coef_covariance, self.contrast_matrix, self.regression_coefs, self.baseline_variance)


    def _baseline_covariance_zero(self) -> bool:
        return (
            self.stat_a.pre_statistic.variance + self.stat_b.pre_statistic.variance <= 0
        )

    def compute_result(self) -> StrataResultCount:
        return StrataResultCount(
            n=self.n, 
            effect=self.mean[0],
            effect_cov=self.covariance[0, 0],
            control_mean=self.mean[1],
            control_mean_cov=self.covariance[1, 1],
            effect_control_mean_cov=self.covariance[0, 1],
        )



# Algorithm 1 for ratio metrics
class CreateStrataResultRatio(CreateStrataResultBase):
    def __init__(
        self,
        stat_a: RatioStatistic,
        stat_b: RatioStatistic,
    ):
        self.stat_a = stat_a
        self.stat_b = stat_b

    @property
    def len_alpha(self) -> int:
        return 2
    
    @property
    def regression_coefs(self) -> np.ndarray:
        return np.array(
            [
                self.stat_b.m_statistic.mean,
                self.stat_b.d_statistic.mean,
                self.stat_a.m_statistic.mean,
                self.stat_a.d_statistic.mean,
            ]
        )

    @property
    def lambda_a(self) -> np.ndarray:
        return np.array(
            [
                self.stat_a.m_statistic.variance,
                self.stat_a.covariance,
                self.stat_a.covariance,
                self.stat_a.d_statistic.variance,
            ]
        ).reshape(self.len_alpha, self.len_alpha)

    @property
    def lambda_b(self) -> np.ndarray:
        return np.array(
            [
                self.stat_b.m_statistic.variance,
                self.stat_b.covariance,
                self.stat_b.covariance,
                self.stat_b.d_statistic.variance,
            ]
        ).reshape(self.len_alpha, self.len_alpha)
    

    @property
    def regression_coefs_covariance(self) -> np.ndarray:
        return CreateStrataResult.compute_regression_coefs_covariance(self.len_alpha, self.n, self.n_a, self.n_b, self.lambda_a, self.lambda_b)

    @property
    def contrast_matrix(self) -> np.ndarray:
        return np.array([[0, 0, 1, 0], [1, 0, -1, 0], [0, 0, 0, 1], [0, 1, 0, -1]])
    
    @property
    def covariance(self) -> np.ndarray:
        return CreateStrataResult.covariance_unadjusted(self.contrast_matrix, self.regression_coefs_covariance)

    def compute_result(self) -> StrataResultRatio:
        return StrataResultRatio(
            n=self.n,
            numerator_effect=self.mean[0],
            numerator_control_mean=self.mean[1],
            denominator_effect=self.mean[2],
            denominator_control_mean=self.mean[3],
            numerator_effect_cov=self.covariance[0, 0],
            numerator_control_mean_cov=self.covariance[1, 1],
            denominator_effect_cov=self.covariance[2, 2],
            denominator_control_mean_cov=self.covariance[3, 3],
            numerator_effect_numerator_control_mean_cov=self.covariance[0, 1],
            numerator_effect_denominator_effect_cov=self.covariance[0, 2],
            numerator_effect_denominator_control_mean_cov=self.covariance[0, 3],
            numerator_control_mean_denominator_effect_cov=self.covariance[1, 2],
            numerator_control_mean_denominator_control_mean_cov=self.covariance[1, 3], 
            denominator_effect_denominator_control_mean_cov=self.covariance[2, 3]
        )


# Regression version of Algorithm 1 for ratio metrics
class CreateStrataResultRegressionAdjustedRatio(CreateStrataResultBase):    
    def __init__(
        self,
        stat_a: RegressionAdjustedRatioStatistic,
        stat_b: RegressionAdjustedRatioStatistic,
        theta: Optional[float] = None,
    ):
        self.stat_a = stat_a
        self.stat_b = stat_b
        self.theta = theta

    @property
    def len_alpha(self) -> int:
        return 4

    @property
    def len_gamma(self) -> int:
        return 8

    @property
    def xtx(self) -> np.ndarray:
        xtx = np.zeros((4, 4))
        xtx[0, 0] = self.n_a + self.n_b
        xtx[1, 1] = self.n_b
        xtx[2, 2] = (
            self.stat_a.m_statistic_pre.sum_squares
            + self.stat_b.m_statistic_pre.sum_squares
        )
        xtx[3, 3] = (
            self.stat_a.d_statistic_pre.sum_squares
            + self.stat_b.d_statistic_pre.sum_squares
        )
        xtx[0, 1] = xtx[1, 0] = xtx[1, 1]
        xtx[0, 2] = xtx[2, 0] = (
            self.stat_a.m_statistic_pre.sum + self.stat_b.m_statistic_pre.sum
        )
        xtx[0, 3] = xtx[3, 0] = (
            self.stat_a.d_statistic_pre.sum + self.stat_b.d_statistic_pre.sum
        )
        xtx[1, 2] = xtx[2, 1] = self.stat_b.m_statistic_pre.sum
        xtx[1, 3] = xtx[3, 1] = self.stat_b.d_statistic_pre.sum
        xtx[2, 3] = xtx[3, 2] = (
            self.stat_a.m_pre_d_pre_sum_of_products
            + self.stat_b.m_pre_d_pre_sum_of_products
        )
        return xtx
    
    @property
    def xtx_inv(self) -> np.ndarray:
        return np.linalg.inv(self.xtx)

    @property
    def xty_numerator(self) -> np.ndarray:
        xty = np.zeros((4, 1))
        xty[0] = self.stat_a.m_statistic_post.sum + self.stat_b.m_statistic_post.sum
        xty[1] = self.stat_b.m_statistic_post.sum
        xty[2] = (
            self.stat_a.m_post_m_pre_sum_of_products
            + self.stat_b.m_post_m_pre_sum_of_products
        )
        xty[3] = (
            self.stat_a.m_post_d_pre_sum_of_products
            + self.stat_b.m_post_d_pre_sum_of_products
        )
        return xty

    @property
    def xty_denominator(self) -> np.ndarray:
        xty = np.zeros((4, 1))
        xty[0] = self.stat_a.d_statistic_post.sum + self.stat_b.d_statistic_post.sum
        xty[1] = self.stat_b.d_statistic_post.sum
        xty[2] = (
            self.stat_a.m_pre_d_post_sum_of_products
            + self.stat_b.m_pre_d_post_sum_of_products
        )
        xty[3] = (
            self.stat_a.d_post_d_pre_sum_of_products
            + self.stat_b.d_post_d_pre_sum_of_products
        )
        return xty

    @property
    def gammahat_numerator(self) -> np.ndarray:
        return self.xtx_inv.dot(self.xty_numerator)

    @property
    def gammahat_denominator(self) -> np.ndarray:
        return self.xtx_inv.dot(self.xty_denominator)

    @property
    def regression_coefs(self) -> np.ndarray:
        return np.concatenate(
            (self.gammahat_numerator, self.gammahat_denominator), axis=0
        )

    @property
    def sigma_1_1(self) -> float:
        resids_part_1 = (
            self.stat_a.m_statistic_post.sum_squares
            + self.stat_b.m_statistic_post.sum_squares
        )
        resids_part_2 = -self.xty_numerator.T.dot(self.xtx_inv).dot(self.xty_numerator)
        return (resids_part_1 + resids_part_2) / (self.n - 6)

    @property
    def sigma_2_2(self) -> float:
        resids_part_1 = (
            self.stat_a.d_statistic_post.sum_squares
            + self.stat_b.d_statistic_post.sum_squares
        )
        resids_part_2 = -self.xty_denominator.T.dot(self.xtx_inv).dot(
            self.xty_denominator
        )
        return (resids_part_1 + resids_part_2) / (self.n - 6)

    @property
    def sigma_1_2(self) -> float:
        resids_part_1 = (
            self.stat_a.m_post_d_post_sum_of_products
            + self.stat_b.m_post_d_post_sum_of_products
        )
        resids_part_2 = -self.xty_numerator.T.dot(self.gammahat_denominator)
        resids_part_3 = -self.xty_denominator.T.dot(self.gammahat_numerator)
        resids_part_4 = self.gammahat_numerator.T.dot(self.xtx).dot(
            self.gammahat_denominator
        )
        return (resids_part_1 + resids_part_2 + resids_part_3 + resids_part_4) / (
            self.n - 6
        )

    @property
    def sigma(self) -> np.ndarray:
        return np.array(
            [[self.sigma_1_1, self.sigma_1_2], [self.sigma_1_2, self.sigma_2_2]]
        ).reshape(2, 2)

    @property
    def baseline_mean_numerator(self) -> float:
        m_statistic_pre = self.stat_a.m_statistic_pre + self.stat_b.m_statistic_pre
        return m_statistic_pre.mean

    @property
    def baseline_mean_denominator(self) -> float:
        d_statistic_pre = self.stat_a.d_statistic_pre + self.stat_b.d_statistic_pre
        return d_statistic_pre.mean

    @property
    def baseline_variance_numerator(self) -> float:
        m_statistic_pre = self.stat_a.m_statistic_pre + self.stat_b.m_statistic_pre
        return m_statistic_pre.variance

    @property
    def baseline_variance_denominator(self) -> float:
        d_statistic_pre = self.stat_a.d_statistic_pre + self.stat_b.d_statistic_pre
        return d_statistic_pre.variance

    @property
    def baseline_covariance(self) -> float:
        stat_combined = self.stat_a + self.stat_b
        return stat_combined.cov_m_pre_d_pre

    @property
    def contrast_matrix(self) -> np.ndarray:
        m = np.zeros((4, 8))
        m[0, :] = [
            1,
            0,
            self.baseline_mean_numerator,
            self.baseline_mean_denominator,
            0,
            0,
            0,
            0,
        ]
        m[1, :] = [0, 1, 0, 0, 0, 0, 0, 0]
        m[2, :] = [
            0,
            0,
            0,
            0,
            1,
            0,
            self.baseline_mean_numerator,
            self.baseline_mean_denominator,
        ]
        m[3, :] = [0, 0, 0, 0, 0, 1, 0, 0]
        return m

    def contrast_matrix_covariance(self, i: int, j: int) -> np.ndarray:
        v = np.zeros((self.len_gamma, self.len_gamma))
        if i == 0 and j == 0:
            v[2, 2] = self.baseline_variance_numerator / self.n
            v[3, 3] = self.baseline_variance_denominator / self.n
            v[2, 3] = v[3, 2] = self.baseline_covariance / self.n

        if i == 2 and j == 2:
            v[6, 6] = self.baseline_variance_numerator / self.n
            v[7, 7] = self.baseline_variance_denominator / self.n
            v[6, 7] = v[7, 6] = self.baseline_covariance / self.n

        if i == 0 and j == 2:
            v[2, 6] = self.baseline_variance_numerator / self.n
            v[3, 7] = self.baseline_variance_denominator / self.n
            v[2, 7] = v[3, 6] = self.baseline_covariance / self.n

        if i == 2 and j == 0:
            v[6, 2] = self.baseline_variance_numerator / self.n
            v[7, 3] = self.baseline_variance_denominator / self.n
            v[7, 2] = v[6, 3] = self.baseline_covariance / self.n

        return v

    def _baseline_covariance_zero(self) -> bool:
        m_check = (
            self.stat_a.m_statistic_pre.variance + self.stat_b.m_statistic_pre.variance
            <= 0
        )
        d_check = (
            self.stat_a.d_statistic_pre.variance + self.stat_b.d_statistic_pre.variance
            <= 0
        )
        return m_check or d_check
    
    @property
    def coef_covariance(self) -> np.ndarray:
        return CreateStrataResultRegressionAdjusted.create_coef_covariance(self.sigma, self.xtx_inv)
    
    def contrast_matrix_second_moment(self, i: int, j: int) -> np.ndarray:
        m_i = CreateStrataResultRegressionAdjusted.contrast_matrix_estimated_mean(self.contrast_matrix, i)
        m_j = CreateStrataResultRegressionAdjusted.contrast_matrix_estimated_mean(self.contrast_matrix, j)
        return self.contrast_matrix_covariance(i, j) + m_i.dot(m_j.T)

    @property
    def covariance(self) -> np.ndarray:
        v_alpha = np.zeros((self.len_alpha, self.len_alpha))
        for i in range(self.len_alpha):
            for j in range(i + 1):
                sum_1 = sum(
                    np.diag(
                        self.coef_covariance.dot(
                            self.contrast_matrix_second_moment(i, j)
                        )
                    )
                )
                sum_2 = sum(
                    np.diag(
                        self.regression_coefs.dot(self.regression_coefs.T).dot(
                            self.contrast_matrix_covariance(i, j)
                        )
                    )
                )
                v_alpha[i, j] = sum_1 + sum_2
                v_alpha[j, i] = v_alpha[i, j]
        return float(self.n) * v_alpha

    def compute_result(self) -> StrataResultRatio:
        if self._baseline_covariance_zero():
            stat_a = RatioStatistic(
                n=self.stat_a.n,
                m_statistic=self.stat_a.m_statistic_post,
                d_statistic=self.stat_a.d_statistic_post,
                m_d_sum_of_products=self.stat_a.m_post_d_post_sum_of_products,
            )
            stat_b = RatioStatistic(
                n=self.stat_b.n,
                m_statistic=self.stat_b.m_statistic_post,
                d_statistic=self.stat_b.d_statistic_post,
                m_d_sum_of_products=self.stat_b.m_post_d_post_sum_of_products,
            )
            return CreateStrataResultRatio(stat_a, stat_b).compute_result()
        else:
            return StrataResultRatio(
                n=self.n,
                numerator_effect=self.mean[0],
                numerator_control_mean=self.mean[1],
                denominator_effect=self.mean[2],
                denominator_control_mean=self.mean[3],
                numerator_effect_cov=self.covariance[0, 0],
                numerator_control_mean_cov=self.covariance[1, 1],
                denominator_effect_cov=self.covariance[2, 2],
                denominator_control_mean_cov=self.covariance[3, 3],
                numerator_effect_numerator_control_mean_cov=self.covariance[0, 1],
                numerator_effect_denominator_effect_cov=self.covariance[0, 2],
                numerator_effect_denominator_control_mean_cov=self.covariance[0, 3],
                numerator_control_mean_denominator_effect_cov=self.covariance[1, 2],
                numerator_control_mean_denominator_control_mean_cov=self.covariance[1, 3], 
                denominator_effect_denominator_control_mean_cov=self.covariance[2, 3]
            )


# Algorithm 4
class PostStratificationSummary:
    def __init__(
        self,
        strata_results: List[StrataResultCount],
        nu_hat: Optional[np.ndarray] = None,
        relative: bool = True,
    ):
        self.strata_results = strata_results
        self.nu_hat = (
            nu_hat
            if nu_hat is not None
            else np.array([stat.n for stat in self.strata_results])
            / np.sum([stat.n for stat in self.strata_results])
        )
        self.relative = relative

    @property
    def n(self) -> np.ndarray:
        return np.array([stat.n for stat in self.strata_results])

    @property
    def n_total(self) -> int:
        return int(np.sum(self.n).item())

    @property
    def len_alpha(self) -> int:
        return 2

    @property
    def num_cells(self) -> int:
        return len(self.strata_results)

    @property
    def alpha_matrix(self) -> np.ndarray:
        alpha_matrix = np.zeros((self.len_alpha, self.num_cells))
        for i, stat in enumerate(self.strata_results):
            alpha_matrix[:, i] = [stat.effect, stat.control_mean]
        return alpha_matrix

    @property
    def mean(self) -> np.ndarray:
        return self.alpha_matrix.dot(self.nu_hat)

    @property
    def covariance_nu(self) -> np.ndarray:
        return multinomial_covariance(self.nu_hat) / self.n_total

    @property
    def covariance_part_1(self) -> np.ndarray:
        return self.alpha_matrix.dot(self.covariance_nu).dot(self.alpha_matrix.T)

    @staticmethod
    def multinomial_third_moments(
        nu: np.ndarray, index_0: int, index_1: int, index_2: int, n_total: int
    ) -> float:
        """
        Third moments from multinomial distribution, e.g., E(x[index_0] * x[index_1] * x[index_2])
        from Quiment 2020 https://arxiv.org/pdf/2006.09059 Equation 3.3

        Args:
            nu: Array of probabilities that sum to 1
            index_0, index_1, index_2: Indices for the third moment calculation
            n_total: Total number of trials

        Returns:
            The third moment value
        """
        coef = n_total * (n_total - 1) * (n_total - 2)
        coef_same_1 = 3 * n_total * (n_total - 1)
        coef_same_2 = n_total
        coef_one_diff = n_total * (n_total - 1)

        if index_0 == index_1 and index_0 == index_2:
            return (
                coef * nu[index_0] ** 3
                + coef_same_1 * nu[index_0] ** 2
                + coef_same_2 * nu[index_0]
            )
        elif index_0 == index_1 and index_0 != index_2:
            # case where i == j, but i != l
            return (
                coef * nu[index_0] ** 2 * nu[index_2]
                + coef_one_diff * nu[index_0] * nu[index_2]
                + coef_same_2 * nu[index_0]
            )
        elif index_1 == index_2 and index_0 != index_2:
            return (
                coef * nu[index_0] ** 2 * nu[index_1]
                + coef_one_diff * nu[index_0] * nu[index_1]
                + coef_same_2 * nu[index_1]
            )
        else:
            raise ValueError("Invalid combination of indices")

    @property
    def third_moments_matrix(self) -> np.ndarray:
        """
        Calculate and normalize theoretical third moments matrix for a multinomial distribution.

        Args:
            n: Array of counts

        Returns:
            Normalized matrix of third moments
        """
        # Initialize matrix for theoretical moments
        moments_theoretical_y = np.empty((self.num_cells, self.num_cells))

        # Calculate third moments for each cell combination
        for i in range(self.num_cells):
            for j in range(self.num_cells):
                moments_theoretical_y[i, j] = self.multinomial_third_moments(
                    self.nu_hat, i, j, j, self.n_total
                )

        # Normalize by n_total^3
        nu_mat = moments_theoretical_y / (self.n_total**3)

        return nu_mat
    
    @staticmethod
    def cell_covariance(stat: StrataResultCount) -> np.ndarray:
        return np.array([[stat.effect_cov, stat.effect_control_mean_cov], [stat.effect_control_mean_cov, stat.control_mean_cov]])

    @property
    def v_full(self) -> np.ndarray:
        v_full = np.empty((self.num_cells, self.len_alpha, self.len_alpha))
        for cell in range(self.num_cells):
            v = self.cell_covariance(self.strata_results[cell])
            v_full[cell] = v / self.nu_hat[cell]
        return v_full

    @property
    def covariance_part_2(self) -> np.ndarray:
        covariance_2 = np.zeros((self.len_alpha, self.len_alpha))
        for row in range(self.len_alpha):
            for col in range(self.len_alpha):
                covariance_2[row, col] = np.sum(
                    np.diag(self.v_full[:, row, col]).dot(self.third_moments_matrix)
                )
        return covariance_2 / self.n_total

    @property
    def covariance(self) -> np.ndarray:
        return self.covariance_part_1 + self.covariance_part_2

    @property
    def nabla(self) -> np.ndarray:
        if self.relative:
            if self.mean[0] == 0:
                return np.zeros((self.len_alpha,))
            else:
                return np.array([-self.mean[1] / self.mean[0] ** 2, 1 / self.mean[0]])
        else:
            return np.array([0, 1])

    @property
    def point_estimate(self) -> float:
        if self.relative:
            if self.mean[0] == 0:
                return 0
            else:
                return self.mean[1] / self.mean[0]
        else:
            return self.mean[1]

    @property
    def estimated_variance(self) -> float:
        return float(self.nabla.T.dot(self.covariance).dot(self.nabla))

    @property
    def unadjusted_baseline_mean(self) -> float:
        return self.mean[0]

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
            pairwise_sample_size=0,
            error_message=error_message,
        )

    def _has_zero_variance(self) -> bool:
        """Check if any variance is 0 or negative"""
        return self.estimated_variance <= 0

    def compute_result(self) -> EffectMomentsResult:
        if self._has_zero_variance():
            return self._default_output(error_message="ZERO_VARIANCE")
        if self.unadjusted_baseline_mean == 0:
            return self._default_output(error_message=BASELINE_VARIATION_ZERO_MESSAGE)
        return EffectMomentsResult(
            point_estimate=self.point_estimate,
            standard_error=np.sqrt(self.estimated_variance),
            pairwise_sample_size=self.n_total,
            error_message=None,
        )


# Algorithm 3
class PostStratificationSummaryRatio(PostStratificationSummary):
    def __init__(
        self,
        strata_results: List[StrataResultRatio],
        nu_hat: Optional[np.ndarray] = None,
        relative: bool = True,
    ):
        self.strata_results = strata_results
        self.nu_hat = (
            nu_hat
            if nu_hat is not None
            else np.array([stat.n for stat in self.strata_results])
            / np.sum([stat.n for stat in self.strata_results])
        )
        self.relative = relative

    @property
    def len_alpha(self) -> int:
        return 4
    
    @staticmethod
    def cell_covariance(stat: StrataResultRatio) -> np.ndarray:
        return np.array([[stat.numerator_effect_cov, 
                          stat.numerator_effect_numerator_control_mean_cov,
                          stat.numerator_effect_denominator_effect_cov,
                          stat.numerator_effect_denominator_control_mean_cov],
                          [stat.numerator_effect_numerator_control_mean_cov,
                          stat.numerator_control_mean_cov,
                          stat.numerator_control_mean_denominator_effect_cov,
                          stat.numerator_control_mean_denominator_control_mean_cov],
                          [stat.numerator_effect_denominator_effect_cov,
                          stat.numerator_control_mean_denominator_effect_cov,
                          stat.denominator_effect_cov,
                          stat.denominator_effect_denominator_control_mean_cov],
                          [stat.numerator_effect_denominator_control_mean_cov,
                          stat.numerator_control_mean_denominator_control_mean_cov,
                          stat.denominator_effect_denominator_control_mean_cov,
                          stat.denominator_control_mean_cov]
                          ])
    
    @property
    def alpha_matrix(self) -> np.ndarray:
        alpha_matrix = np.zeros((self.len_alpha, self.num_cells))
        for i, stat in enumerate(self.strata_results):
            alpha_matrix[:, i] = [stat.numerator_effect, stat.numerator_control_mean, stat.denominator_effect, stat.denominator_control_mean]
        return alpha_matrix

    @property
    def nabla(self) -> np.ndarray:
        if self.mean[2] == 0 or self.mean[3] == 0:
            return np.zeros((self.len_alpha,))
        nabla = np.empty((self.len_alpha,))

        if self.relative:
            if self.mean[0] == 0:
                return np.zeros((self.len_alpha,))
            else:
                nabla[0] = (
                    self.mean[2] * self.point_estimate_rel_denominator
                    - (self.mean[2] + self.mean[3]) * self.point_estimate_rel_numerator
                ) / self.point_estimate_rel_denominator**2
                nabla[1] = self.mean[2] / self.point_estimate_rel_denominator
                nabla[2] = (
                    (self.mean[0] + self.mean[1]) * self.point_estimate_rel_denominator
                    - self.mean[0] * self.point_estimate_rel_numerator
                ) / self.point_estimate_rel_denominator**2
                nabla[3] = -self.point_estimate_rel_numerator / (
                    self.mean[0] * (self.mean[2] + self.mean[3]) ** 2
                )

        else:
            nabla[1] = 1 / (self.mean[2] + self.mean[3])
            nabla[0] = nabla[1] - 1 / self.mean[2]
            nabla[3] = -(self.mean[0] + self.mean[1]) / (
                (self.mean[2] + self.mean[3]) ** 2
            )
            nabla[2] = nabla[3] + self.mean[0] / self.mean[2] ** 2
        return nabla

    @property
    def point_estimate_rel_numerator(self) -> float:
        return self.mean[2] * (self.mean[0] + self.mean[1])

    @property
    def point_estimate_rel_denominator(self) -> float:
        return self.mean[0] * (self.mean[2] + self.mean[3])

    @property
    def point_estimate(self) -> float:
        if self.relative:
            if self.point_estimate_rel_denominator == 0:
                return 0
            else:
                return (
                    self.point_estimate_rel_numerator
                    / self.point_estimate_rel_denominator
                    - 1
                )
        else:
            mn_trt_num = self.mean[0] + self.mean[1]
            mn_trt_den = self.mean[2] + self.mean[3]
            mn_ctrl_num = self.mean[0]
            mn_ctrl_den = self.mean[2]
            if mn_trt_den == 0 or mn_ctrl_den == 0:
                return 0
            else:
                return mn_trt_num / mn_trt_den - mn_ctrl_num / mn_ctrl_den

    @property
    def unadjusted_baseline_mean(self) -> float:
        if self.mean[2] == 0:
            return 0
        else:
            return self.mean[0] / self.mean[2]


class EffectMomentsPostStratification:
    def __init__(
        self,
        stats: List[Tuple[SummableStatistic, SummableStatistic]],
        config: EffectMomentsConfig = EffectMomentsConfig(),
    ):
        self.stats = stats
        self.stat_a, self.stat_b = sum_stats(list(self.stats))
        self.relative = config.difference_type == "relative"

    def _default_output(
        self, error_message: Optional[str] = None
    ) -> EffectMomentsResult:
        """Return uninformative output when AB test analysis can't be performed adequately"""
        return EffectMomentsResult(
            point_estimate=0,
            standard_error=0,
            pairwise_sample_size=0,
            error_message=error_message,
        )

    def _has_zero_variance(self) -> bool:
        """Check if any variance is 0 or negative"""
        return self.stat_a._has_zero_variance or self.stat_b._has_zero_variance
    
    @staticmethod
    def create_cells_for_analysis(stats: List[Tuple[SummableStatistic, SummableStatistic]]) -> List[Tuple[SummableStatistic, SummableStatistic]]:
        sorted_cells = sorted(stats, key=lambda x: x[0].n + x[1].n, reverse=True)
        min_n = [min(t[0].n, t[1].n) for t in sorted_cells]
        num_strata = len(min_n)
        cells_for_analysis = [sorted_cells[0]]
        for i in range(1, num_strata):
            if min_n[i] == 0:
                cells_for_analysis[0] = (cells_for_analysis[0][0] + sorted_cells[i][0], cells_for_analysis[0][1] + sorted_cells[i][1])        
            else:
                cells_for_analysis.append(sorted_cells[i])
        if cells_for_analysis[0][0].n == 0 or cells_for_analysis[0][1].n == 0:
            return sum_stats(cells_for_analysis)
        return cells_for_analysis

    def compute_result(self) -> EffectMomentsResult:
        if self._has_zero_variance():
            return self._default_output(ZERO_NEGATIVE_VARIANCE_MESSAGE)
        if self.stat_a.mean == 0:
            return self._default_output(BASELINE_VARIATION_ZERO_MESSAGE)
        if self.stat_a.unadjusted_mean == 0:
            return self._default_output(BASELINE_VARIATION_ZERO_MESSAGE)
        
        #if any cells have 0 users in a variation, add that cell to the cell with the largest number of users
        cells_for_analysis = self.create_cells_for_analysis(self.stats)
        #if there is only one strata cell, we can just run the regular effect moments test
        if len(cells_for_analysis) == 1:
            return EffectMoments(cells_for_analysis, EffectMomentsConfig(difference_type="relative" if self.relative else "absolute")).compute_result() #type: ignore                
        strata_results = []
        for _, cell in enumerate(cells_for_analysis):
            strata_results.append(self.compute_strata_result(cell))
        if isinstance(strata_results[0], StrataResultRatio):
            return PostStratificationSummaryRatio(
                strata_results, nu_hat=None, relative=self.relative
            ).compute_result()
        else:
            return PostStratificationSummary(
                strata_results, nu_hat=None, relative=self.relative
            ).compute_result()

    def compute_strata_result(
        self, stat_pair: Tuple[TestStatistic, TestStatistic]
    ) -> Union[StrataResultCount, StrataResultRatio]:
        if isinstance(
            stat_pair[0], Union[ProportionStatistic, SampleMeanStatistic]
        ) and isinstance(stat_pair[1], Union[ProportionStatistic, SampleMeanStatistic]):
            return CreateStrataResult(stat_pair[0], stat_pair[1]).compute_result()
        elif isinstance(stat_pair[0], RegressionAdjustedStatistic) and isinstance(
            stat_pair[1], RegressionAdjustedStatistic
        ):
            return CreateStrataResultRegressionAdjusted(
                stat_pair[0], stat_pair[1]
            ).compute_result()
        elif isinstance(stat_pair[0], RatioStatistic) and isinstance(
            stat_pair[1], RatioStatistic
        ):
            return CreateStrataResultRatio(stat_pair[0], stat_pair[1]).compute_result()
        elif isinstance(stat_pair[0], RegressionAdjustedRatioStatistic) and isinstance(
            stat_pair[1], RegressionAdjustedRatioStatistic
        ):
            return CreateStrataResultRegressionAdjustedRatio(
                stat_pair[0], stat_pair[1]
            ).compute_result()
        else:
            raise ValueError("Invalid statistic pair")
