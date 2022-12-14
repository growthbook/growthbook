from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List

import numpy as np

# For now this dataclass is a bit unwieldy to hold inputs from sql
# @dataclass
# class Statistic:
#     value: float
#     stddev: float
#     count: int
#     n: int

#     @property
#     def variance(self) -> float:
#         return pow(self.stddev, 2)


@dataclass
class Statistic(ABC):
    n: int

    @property
    @abstractmethod
    def variance(self):
        pass

    @property
    def stddev(self):
        return np.sqrt(self.variance)

    @property
    @abstractmethod
    def mean(self):
        pass


@dataclass
class SampleMeanStatistic(Statistic):
    sum: float
    sum_of_squares: float

    @property
    def variance(self):
        return (self.sum_of_squares - pow(self.sum, 2) / self.n) / (self.n - 1)

    @property
    def mean(self):
        return self.sum / self.n


@dataclass
class ProportionStatistic(Statistic):
    sum: float

    @property
    def sum_of_squares(self) -> float:
        return self.sum

    @property
    def variance(self):
        return self.mean * (1 - self.mean)

    @property
    def mean(self):
        return self.sum / self.n


@dataclass
class RatioStatistic(Statistic):
    m_statistic: Statistic
    d_statistic: Statistic
    m_d_sum_of_products: float
    n: int

    @property
    def mean(self):
        return self.m_statistic.sum / self.d_statistic.sum

    @property
    def variance(self):
        return (
            self.m_statistic.variance / pow(self.d_statistic.mean, 2)
            - self.m_statistic.mean / pow(self.d_statistic.mean, 3)
            + pow(self.m_statistic.mean, 2)
            * self.d_statistic.variance
            / pow(self.d_statistic.mean, 4)
        )


@dataclass
class RAStatistic:
    a_pre_exposure_statistic: Statistic
    a_post_exposure_statistic: Statistic
    b_pre_exposure_statistic: Statistic
    a_post_exposure_statistic: Statistic
    a_pre_post_sum_of_products: float
    b_pre_post_sum_of_products: float

    def compute_theta(self):
        pooled_pre_statistic = Statistic(
            sum=self.a_pre_exposure_statistic.sum + self.b_pre_exposure_statistic.sum,
            sum_of_squares=self.a_pre_exposure_statistic.sum_of_squares
            + self.b_pre_exposure_statistic.sum_of_squares,
            n=self.a_pre_exposure_statistic.n + self.b_pre_exposure_statistic.n,
        )

        pooled_pre_post_sum_of_products = (
            self.a_pre_post_sum_of_products + self.b_pre_post_sum_of_products
        )
        pooled_n = self.a_post_exposure_statistic.n + self.a_post_exposure_statistic.n
        pooled_pre_post_covariance = (
            1
            / (pooled_n - 1)
            * (
                pooled_pre_post_sum_of_products
                - (
                    (
                        self.a_post_exposure_statistic.sum
                        + self.b_post_exposure_statistic.sum
                    )
                    * (
                        self.a_pre_exposure_statistic.sum
                        + self.b_pre_exposure_statistic.sum
                    )
                )
            )
        )

        theta = pooled_pre_post_covariance / pooled_pre_statistic.variance
        return theta

    def __post_init__(self):
        self.theta = self.compute_theta()


# Data classes for the results of tests
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


@dataclass
class BayesianTestResult(TestResult):
    chance_to_win: float
    risk: List[float]
    relative_risk: List[float]


@dataclass
class FrequentistTestResult(TestResult):
    p_value: float
