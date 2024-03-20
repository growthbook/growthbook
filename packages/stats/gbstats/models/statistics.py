from abc import ABC, abstractmethod
from typing import Union

import numpy as np
import scipy.stats
from pydantic.dataclasses import dataclass


@dataclass
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


@dataclass
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


@dataclass
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


@dataclass
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
        return (
            self.m_statistic.variance / pow(self.d_statistic.mean, 2)
            - 2
            * self.covariance
            * self.m_statistic.mean
            / pow(self.d_statistic.mean, 3)
            + pow(self.m_statistic.mean, 2)
            * self.d_statistic.variance
            / pow(self.d_statistic.mean, 4)
        )

    @property
    def covariance(self):
        if self.n <= 1:
            return 0
        return (
            self.m_d_sum_of_products
            - self.m_statistic.sum * self.d_statistic.sum / self.n
        ) / (self.n - 1)


@dataclass
class RegressionAdjustedStatistic(Statistic):
    post_statistic: Union[SampleMeanStatistic, ProportionStatistic]
    pre_statistic: Union[SampleMeanStatistic, ProportionStatistic]
    post_pre_sum_of_products: float
    theta: float

    @property
    def mean(self):
        return self.post_statistic.mean - self.theta * self.pre_statistic.mean

    @property
    def sum(self):
        raise NotImplementedError(
            "Regression Adjusted Statistic does not have a unique `sum` property"
        )

    @property
    def unadjusted_mean(self):
        return self.post_statistic.mean

    @property
    def variance(self):
        if self.n <= 1:
            return 0
        return (
            self.post_statistic.variance
            + pow(self.theta, 2) * self.pre_statistic.variance
            - 2 * self.theta * self.covariance
        )

    @property
    def covariance(self):
        if self.n <= 1:
            return 0
        return (
            self.post_pre_sum_of_products
            - self.post_statistic.sum * self.pre_statistic.sum / self.n
        ) / (self.n - 1)


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


@dataclass
class QuantileStatistic(Statistic):
    n: int  # number of events here
    nu: float
    alpha: float
    q_hat: float  # sample estimate
    q_lower: float
    q_upper: float
    main_sum: float  # numerator sum
    main_sum_squares: float
    denominator_sum: float  # denominator sum
    denominator_sum_squares: float
    main_denominator_sum_product: float

    @property
    def _has_zero_variance(self) -> bool:
        return self.variance_init <= 0.0 and self.n < 100

    @property
    def mean(self) -> float:
        return self.q_hat

    @property
    def unadjusted_mean(self) -> float:
        return self.mean

    @property
    def variance_init(self) -> float:
        multiplier = scipy.stats.norm.ppf(1.0 - 0.5 * self.alpha, loc=0, scale=1)
        quantile_above_one = self.n <= multiplier**2 * self.nu / (1.0 - self.nu)
        quantile_below_zero = self.n <= multiplier**2 * (1.0 - self.nu) / self.nu
        if quantile_above_one or quantile_below_zero:
            return 0
        num = self.q_upper - self.q_lower
        den = 2 * multiplier
        return float((self.n - 1) * (num / den) ** 2)

    @property
    def variance(self) -> float:
        if self.n < 100:
            return self.variance_init
        else:
            return max(self.variance_init, float(1e-5))


@dataclass
class QuantileStatisticClustered(QuantileStatistic):
    n_clusters: int

    @property
    def variance_init(self):
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
        num = (
            sigma_2_s - 2 * mu_s * sigma_s_n / mu_n + mu_s**2 * sigma_2_n / mu_n**2
        )
        den = self.n_clusters * mu_n**2
        return num / den


TestStatistic = Union[
    ProportionStatistic,
    SampleMeanStatistic,
    RegressionAdjustedStatistic,
    RatioStatistic,
    QuantileStatistic,
    QuantileStatisticClustered,
]
