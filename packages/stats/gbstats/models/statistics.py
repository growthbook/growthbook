from abc import ABC, abstractmethod
from dataclasses import replace
from typing import Optional, Union, List, Tuple

import numpy as np
import scipy.stats
from pydantic.dataclasses import dataclass
from gbstats.utils import variance_of_ratios


@dataclass(frozen=True)
class Statistic(ABC):
    n: int

    @property
    @abstractmethod
    def variance(self) -> float:
        pass

    @property
    def stddev(self):
        return 0 if self.variance <= 0 else np.sqrt(self.variance)

    @property
    @abstractmethod
    def mean(self) -> float:
        pass

    @property
    def unadjusted_mean(self) -> float:
        """
        Return the mean that has no regression adjustments.
        Must be over-ridden if regular `mean` function is adjusted,
        as it is for RegressionAdjustedStatistic
        """
        return self.mean

    @property
    def _has_zero_variance(self) -> bool:
        return self.variance <= 0.0


@dataclass(frozen=True)
class SampleMeanStatistic(Statistic):
    sum: float
    sum_squares: float

    @property
    def variance(self):
        if self.n <= 1:
            return 0
        return (self.sum_squares - pow(self.sum, 2) / self.n) / (self.n - 1)

    @property
    def mean(self):
        if self.n == 0:
            return 0
        return self.sum / self.n

    def __add__(self, other):
        if not isinstance(other, Union[ProportionStatistic, SampleMeanStatistic]):
            raise TypeError(
                "Can add only another ProportionStatistic or SampleMeanStatistic instance"
            )
        return SampleMeanStatistic(
            n=self.n + other.n,
            sum=self.sum + other.sum,
            sum_squares=self.sum_squares + other.sum_squares,
        )


@dataclass(frozen=True)
class ProportionStatistic(Statistic):
    sum: float

    @property
    def sum_squares(self) -> float:
        return self.sum

    @property
    def variance(self):
        return self.mean * (1 - self.mean)

    @property
    def mean(self):
        if self.n == 0:
            return 0
        return self.sum / self.n

    def __add__(self, other):
        if not isinstance(other, Union[ProportionStatistic, SampleMeanStatistic]):
            raise TypeError(
                "Can add only another ProportionStatistic or SampleMeanStatistic instance"
            )

        return SampleMeanStatistic(
            n=self.n + other.n,
            sum=self.sum + other.sum,
            sum_squares=self.sum_squares + other.sum_squares,
        )


@dataclass(frozen=True)
class RatioStatistic(Statistic):
    m_statistic: Union[SampleMeanStatistic, ProportionStatistic]
    d_statistic: Union[SampleMeanStatistic, ProportionStatistic]
    m_d_sum_of_products: float

    @property
    def mean(self):
        if self.d_statistic.sum == 0:
            return 0
        return self.m_statistic.sum / self.d_statistic.sum

    @property
    def sum(self):
        raise NotImplementedError(
            "RatioStatistic does not have a unique `sum` property"
        )

    @property
    def variance(self):
        if self.d_statistic.mean == 0 or self.n <= 1:
            return 0
        return variance_of_ratios(
            self.m_statistic.mean,
            self.m_statistic.variance,
            self.d_statistic.mean,
            self.d_statistic.variance,
            self.covariance,
        )

    @property
    def covariance(self):
        return compute_covariance(
            n=self.n,
            stat_a=self.m_statistic,
            stat_b=self.d_statistic,
            sum_of_products=self.m_d_sum_of_products,
        )

    def __add__(self, other):
        if not isinstance(other, RatioStatistic):
            raise TypeError("Can add only another RatioStatistic instance")
        return RatioStatistic(
            n=self.n + other.n,
            m_statistic=self.m_statistic + other.m_statistic,
            d_statistic=self.d_statistic + other.d_statistic,
            m_d_sum_of_products=self.m_d_sum_of_products + other.m_d_sum_of_products,
        )


@dataclass(frozen=True)
class RegressionAdjustedStatistic(Statistic):
    post_statistic: Union[SampleMeanStatistic, ProportionStatistic]
    pre_statistic: Union[SampleMeanStatistic, ProportionStatistic]
    post_pre_sum_of_products: float
    theta: Optional[float]

    def __post_init__(self) -> None:
        if not isinstance(self.post_statistic, type(self.pre_statistic)):
            raise TypeError("post_statistic and pre_statistic must be of the same type")

    def __add__(self, other):
        if not isinstance(other, RegressionAdjustedStatistic):
            raise TypeError("Can add only another RegressionAdjustedStatistic instance")
        return RegressionAdjustedStatistic(
            n=self.n + other.n,
            post_statistic=self.post_statistic + other.post_statistic,
            pre_statistic=self.pre_statistic + other.pre_statistic,
            post_pre_sum_of_products=self.post_pre_sum_of_products
            + other.post_pre_sum_of_products,
            theta=None,
        )

    @property
    def mean(self) -> float:
        theta = self.theta if self.theta else 0
        return self.post_statistic.mean - theta * self.pre_statistic.mean

    @property
    def sum(self) -> None:
        raise NotImplementedError(
            "Regression Adjusted Statistic does not have a unique `sum` property"
        )

    @property
    def unadjusted_mean(self) -> float:
        return self.post_statistic.mean

    @property
    def unadjusted_variances(self) -> float:
        return self.post_statistic.variance

    @property
    def variance(self) -> float:
        if self.n <= 1:
            return 0
        theta = self.theta if self.theta else 0
        return (
            self.post_statistic.variance
            + pow(theta, 2) * self.pre_statistic.variance
            - 2 * theta * self.covariance
        )

    @property
    def covariance(self) -> float:
        return compute_covariance(
            n=self.n,
            stat_a=self.post_statistic,
            stat_b=self.pre_statistic,
            sum_of_products=self.post_pre_sum_of_products,
        )


def compute_covariance(
    n: int,
    stat_a: Union[SampleMeanStatistic, ProportionStatistic],
    stat_b: Union[SampleMeanStatistic, ProportionStatistic],
    sum_of_products: float,
) -> float:

    if n <= 1:
        return 0

    if isinstance(stat_a, ProportionStatistic) and isinstance(
        stat_b, ProportionStatistic
    ):
        return sum_of_products / n - stat_a.sum * stat_b.sum / n**2
    else:
        return (sum_of_products - stat_a.sum * stat_b.sum / n) / (n - 1)


def compute_theta(
    a: RegressionAdjustedStatistic, b: RegressionAdjustedStatistic
) -> float:
    n = a.n + b.n
    joint_post_statistic = create_joint_statistic(
        a=a.post_statistic, b=b.post_statistic, n=n
    )
    joint_pre_statistic = create_joint_statistic(
        a=a.pre_statistic, b=b.pre_statistic, n=n
    )
    if joint_pre_statistic.variance == 0 or joint_post_statistic.variance == 0:
        return 0

    joint = RegressionAdjustedStatistic(
        n=n,
        post_statistic=joint_post_statistic,
        pre_statistic=joint_pre_statistic,
        post_pre_sum_of_products=a.post_pre_sum_of_products
        + b.post_pre_sum_of_products,
        theta=0,
    )
    return joint.covariance / joint.pre_statistic.variance


def create_joint_statistic(
    a: Union[ProportionStatistic, SampleMeanStatistic],
    b: Union[ProportionStatistic, SampleMeanStatistic],
    n: int,
) -> Union[ProportionStatistic, SampleMeanStatistic]:
    if isinstance(a, ProportionStatistic) and isinstance(b, ProportionStatistic):
        return ProportionStatistic(n=n, sum=a.sum + b.sum)
    elif isinstance(a, SampleMeanStatistic) and isinstance(b, SampleMeanStatistic):
        return SampleMeanStatistic(
            n=n, sum=a.sum + b.sum, sum_squares=a.sum_squares + b.sum_squares
        )
    raise ValueError(
        "Statistic types for a metric must not be different types across variations."
    )


@dataclass(frozen=True)
class RegressionAdjustedRatioStatistic(Statistic):
    m_statistic_post: Union[SampleMeanStatistic, ProportionStatistic]
    d_statistic_post: Union[SampleMeanStatistic, ProportionStatistic]
    m_statistic_pre: Union[SampleMeanStatistic, ProportionStatistic]
    d_statistic_pre: Union[SampleMeanStatistic, ProportionStatistic]
    m_post_m_pre_sum_of_products: float
    d_post_d_pre_sum_of_products: float
    m_pre_d_pre_sum_of_products: float
    m_post_d_post_sum_of_products: float
    m_post_d_pre_sum_of_products: float
    m_pre_d_post_sum_of_products: float
    theta: Optional[float]

    def __post_init__(self) -> None:
        if not isinstance(self.m_statistic_post, type(self.m_statistic_pre)):
            raise TypeError(
                "m_statistic_post and m_statistic_pre must be of the same type"
            )
        if not isinstance(self.d_statistic_post, type(self.d_statistic_pre)):
            raise TypeError(
                "d_statistic_post and d_statistic_pre must be of the same type"
            )

    def __add__(self, other):
        if not isinstance(other, RegressionAdjustedRatioStatistic):
            raise TypeError(
                "Can add only another RegressionAdjustedRatioStatistic instance"
            )
        return RegressionAdjustedRatioStatistic(
            n=self.n + other.n,
            m_statistic_post=self.m_statistic_post + other.m_statistic_post,
            d_statistic_post=self.d_statistic_post + other.d_statistic_post,
            m_statistic_pre=self.m_statistic_pre + other.m_statistic_pre,
            d_statistic_pre=self.d_statistic_pre + other.d_statistic_pre,
            m_post_m_pre_sum_of_products=self.m_post_m_pre_sum_of_products
            + other.m_post_m_pre_sum_of_products,
            d_post_d_pre_sum_of_products=self.d_post_d_pre_sum_of_products
            + other.d_post_d_pre_sum_of_products,
            m_pre_d_pre_sum_of_products=self.m_pre_d_pre_sum_of_products
            + other.m_pre_d_pre_sum_of_products,
            m_post_d_post_sum_of_products=self.m_post_d_post_sum_of_products
            + other.m_post_d_post_sum_of_products,
            m_post_d_pre_sum_of_products=self.m_post_d_pre_sum_of_products
            + other.m_post_d_pre_sum_of_products,
            m_pre_d_post_sum_of_products=self.m_pre_d_post_sum_of_products
            + other.m_pre_d_post_sum_of_products,
            theta=None,
        )

    @property
    def mean(self) -> float:
        if self.d_statistic_post.sum == 0 or self.d_statistic_pre.sum == 0:
            return 0
        theta = self.theta if self.theta else 0
        return self.mean_post - theta * self.mean_pre

    @property
    def mean_post(self) -> float:
        if self.d_statistic_post.sum == 0:
            return 0
        return self.m_statistic_post.sum / self.d_statistic_post.sum

    @property
    def mean_pre(self) -> float:
        if self.d_statistic_pre.sum == 0:
            return 0
        return self.m_statistic_pre.sum / self.d_statistic_pre.sum

    @property
    def unadjusted_mean(self) -> float:
        """
        Return the mean that has no regression adjustments.
        Must be over-ridden if regular `mean` function is adjusted,
        as it is for RegressionAdjustedStatistic
        """
        return self.mean_post

    @property
    def sum(self):
        raise NotImplementedError(
            "RatioStatistic does not have a unique `sum` property"
        )

    @property
    def variance(self) -> float:
        return self.nabla.T.dot(self.lambda_matrix).dot(self.nabla)

    @property
    def var_pre(self) -> float:
        return self.nabla[2:4].T.dot(self.lambda_matrix[2:4, 2:4]).dot(self.nabla[2:4])

    @property
    def covariance(self) -> float:
        return self.nabla[2:4].T.dot(self.lambda_matrix[2:4, 0:2]).dot(self.nabla[0:2])

    @property
    def cov_m_pre_d_pre(self) -> float:
        return compute_covariance(
            n=self.n,
            stat_a=self.m_statistic_pre,
            stat_b=self.d_statistic_pre,
            sum_of_products=self.m_pre_d_pre_sum_of_products,
        )

    @property
    def cov_m_post_d_post(self) -> float:
        return compute_covariance(
            n=self.n,
            stat_a=self.m_statistic_post,
            stat_b=self.d_statistic_post,
            sum_of_products=self.m_post_d_post_sum_of_products,
        )

    @property
    def cov_m_post_m_pre(self) -> float:
        return compute_covariance(
            n=self.n,
            stat_a=self.m_statistic_post,
            stat_b=self.m_statistic_pre,
            sum_of_products=self.m_post_m_pre_sum_of_products,
        )

    @property
    def cov_d_post_d_pre(self) -> float:
        return compute_covariance(
            n=self.n,
            stat_a=self.d_statistic_post,
            stat_b=self.d_statistic_pre,
            sum_of_products=self.d_post_d_pre_sum_of_products,
        )

    @property
    def cov_m_post_d_pre(self) -> float:
        return compute_covariance(
            n=self.n,
            stat_a=self.m_statistic_post,
            stat_b=self.d_statistic_pre,
            sum_of_products=self.m_post_d_pre_sum_of_products,
        )

    @property
    def cov_d_post_m_pre(self) -> float:
        return compute_covariance(
            n=self.n,
            stat_a=self.d_statistic_post,
            stat_b=self.m_statistic_pre,
            sum_of_products=self.m_pre_d_post_sum_of_products,
        )

    @property
    def betahat(self) -> np.ndarray:
        return np.array(
            [self.mean_m_post, self.mean_d_post, self.mean_m_pre, self.mean_d_pre]
        )

    @property
    def lambda_matrix(self) -> np.ndarray:
        return np.array(
            [
                [
                    self.var_m_post,
                    self.cov_m_post_d_post,
                    self.cov_m_post_m_pre,
                    self.cov_m_post_d_pre,
                ],
                [
                    self.cov_m_post_d_post,
                    self.var_d_post,
                    self.cov_d_post_m_pre,
                    self.cov_d_post_d_pre,
                ],
                [
                    self.cov_m_post_m_pre,
                    self.cov_d_post_m_pre,
                    self.var_m_pre,
                    self.cov_m_pre_d_pre,
                ],
                [
                    self.cov_m_post_d_pre,
                    self.cov_d_post_d_pre,
                    self.cov_m_pre_d_pre,
                    self.var_d_pre,
                ],
            ]
        )

    # vector of partial derivatives for the absolute case
    @property
    def nabla(self) -> np.ndarray:
        theta = self.theta if self.theta else 0
        if self.betahat[1] == 0 or self.betahat[3] == 0:
            return np.zeros((4,))
        return np.array(
            [
                1 / self.betahat[1],
                -self.betahat[0] / self.betahat[1] ** 2,
                -theta / self.betahat[3],
                theta * self.betahat[2] / self.betahat[3] ** 2,
            ]
        )

    @property
    def mean_m_post(self) -> float:
        return self.m_statistic_post.mean

    @property
    def mean_m_pre(self) -> float:
        return self.m_statistic_pre.mean

    @property
    def mean_d_post(self) -> float:
        return self.d_statistic_post.mean

    @property
    def mean_d_pre(self) -> float:
        return self.d_statistic_pre.mean

    @property
    def var_m_post(self) -> float:
        return self.m_statistic_post.variance

    @property
    def var_m_pre(self) -> float:
        return self.m_statistic_pre.variance

    @property
    def var_d_post(self) -> float:
        return self.d_statistic_post.variance

    @property
    def var_d_pre(self) -> float:
        return self.d_statistic_pre.variance


def compute_theta_regression_adjusted_ratio(
    a: RegressionAdjustedRatioStatistic, b: RegressionAdjustedRatioStatistic
) -> float:
    # set theta equal to 1, so the partial derivatives are unaffected by theta
    a_one = replace(a, theta=1)
    b_one = replace(b, theta=1)
    if a_one.var_pre + b_one.var_pre == 0:
        return 0
    return -(a_one.covariance + b_one.covariance) / (a_one.var_pre + b_one.var_pre)


@dataclass(frozen=True)
class QuantileStatistic(Statistic):
    n: int  # number of events here
    n_star: int  # sample size used when evaluating quantile_lower and quantile_upper
    nu: float  # quantile level of interest
    quantile_hat: float  # sample estimate
    quantile_lower: float
    quantile_upper: float

    @property
    def _has_zero_variance(self) -> bool:
        multiplier = scipy.stats.norm.ppf(1.0 - 0.5 * 0.05, loc=0, scale=1)
        quantile_above_one = self.n <= multiplier**2 * self.nu / (1.0 - self.nu)
        quantile_below_zero = self.n <= multiplier**2 * (1.0 - self.nu) / self.nu
        if quantile_above_one or quantile_below_zero:
            return True
        return self.variance_init <= 0.0 and self.n < 1000

    @property
    def mean(self) -> float:
        return self.quantile_hat

    @property
    def unadjusted_mean(self) -> float:
        return self.mean

    @property
    def variance_init(self) -> float:
        if self.n <= 1:
            return 0
        num = self.quantile_upper - self.quantile_lower
        den = 2 * scipy.stats.norm.ppf(1.0 - 0.5 * 0.05, loc=0, scale=1)
        return float((self.n_star / self.n) * (self.n - 1) * (num / den) ** 2)

    @property
    def variance(self) -> float:
        if self.n < 100:
            return self.variance_init
        else:
            return max(self.variance_init, float(1e-5))


@dataclass(frozen=True)
class QuantileClusteredStatistic(QuantileStatistic):
    main_sum: float  # numerator sum
    main_sum_squares: float
    denominator_sum: float  # denominator sum
    denominator_sum_squares: float
    main_denominator_sum_product: float
    n_clusters: int

    @property
    def variance_init(self):
        if (
            self.n <= 1
            or self.nu == 0
            or self.n_clusters <= 1
            or self.denominator_sum <= 0
        ):
            return 0
        v_iid = super().variance_init
        v_nu_iid = self.nu * (1.0 - self.nu) / self.n
        v_nu_cluster = self.get_cluster_variance
        return v_iid * v_nu_cluster / v_nu_iid

    @property
    def get_cluster_variance(self):
        mu_s = self.main_sum / self.n_clusters
        mu_n = self.denominator_sum / self.n_clusters
        sigma_2_s = (
            (self.main_sum_squares / self.n_clusters - mu_s * mu_s)
            * (self.n_clusters)
            / (self.n_clusters - 1)
        )
        sigma_2_n = (
            (self.denominator_sum_squares / self.n_clusters - mu_n * mu_n)
            * (self.n_clusters)
            / (self.n_clusters - 1)
        )
        sigma_s_n = (
            (self.main_denominator_sum_product / self.n_clusters - mu_s * mu_n)
            * self.n_clusters
            / (self.n_clusters - 1)
        )
        num = sigma_2_s - 2 * mu_s * sigma_s_n / mu_n + mu_s**2 * sigma_2_n / mu_n**2
        den = self.n_clusters * mu_n**2
        return num / den


TestStatistic = Union[
    ProportionStatistic,
    SampleMeanStatistic,
    RegressionAdjustedStatistic,
    RatioStatistic,
    QuantileStatistic,
    QuantileClusteredStatistic,
    RegressionAdjustedRatioStatistic,
]

SummableStatistic = Union[
    ProportionStatistic,
    SampleMeanStatistic,
    RegressionAdjustedStatistic,
    RatioStatistic,
    RegressionAdjustedRatioStatistic,
]

BanditStatistic = Union[
    SampleMeanStatistic,
    RatioStatistic,
    RegressionAdjustedStatistic,
]


ScaledImpactStatistic = Union[
    ProportionStatistic,
    SampleMeanStatistic,
    RegressionAdjustedStatistic,
]


@dataclass
class BanditPeriodDataSampleMean:
    stats: List[SampleMeanStatistic]
    weights: List[float]


@dataclass
class BanditPeriodDataRatio:
    stats: List[RatioStatistic]
    weights: List[float]


@dataclass
class BanditPeriodDataCuped:
    stats: List[RegressionAdjustedStatistic]
    weights: List[float]


def create_theta_adjusted_statistics(
    stat_a: TestStatistic, stat_b: TestStatistic
) -> Tuple[TestStatistic, TestStatistic]:
    if (
        isinstance(stat_b, RegressionAdjustedStatistic)
        and isinstance(stat_a, RegressionAdjustedStatistic)
        and (stat_a.theta is None or stat_b.theta is None)
    ):
        theta = compute_theta(stat_a, stat_b)
        if theta == 0:
            # revert to non-RA under the hood if no variance in a time period
            stat_a = stat_a.post_statistic
            stat_b = stat_b.post_statistic
        else:
            # override statistic with theta initialized
            stat_a = replace(stat_a, theta=theta)
            stat_b = replace(stat_b, theta=theta)
    elif (
        isinstance(stat_b, RegressionAdjustedRatioStatistic)
        and isinstance(stat_a, RegressionAdjustedRatioStatistic)
        and (stat_a.theta is None or stat_b.theta is None)
    ):
        theta = compute_theta_regression_adjusted_ratio(stat_a, stat_b)
        if abs(theta) < 1e-8:
            # revert to non-RA under the hood if no variance in a time period
            stat_a = RatioStatistic(
                n=stat_a.n,
                m_statistic=stat_a.m_statistic_post,
                d_statistic=stat_a.d_statistic_post,
                m_d_sum_of_products=stat_a.m_post_d_post_sum_of_products,
            )
            stat_b = RatioStatistic(
                n=stat_b.n,
                m_statistic=stat_b.m_statistic_post,
                d_statistic=stat_b.d_statistic_post,
                m_d_sum_of_products=stat_b.m_post_d_post_sum_of_products,
            )
        else:
            stat_a = replace(stat_a, theta=theta)
            stat_b = replace(stat_b, theta=theta)
    return stat_a, stat_b
