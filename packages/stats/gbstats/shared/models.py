from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Union

import numpy as np


@dataclass
class Statistic(ABC):
    n: int

    @property
    @abstractmethod
    def variance(self):
        pass

    @property
    def stddev(self):
        return 0 if self.variance == 0 else np.sqrt(self.variance)

    @property
    @abstractmethod
    def mean(self):
        pass


@dataclass
class SampleMeanStatistic(Statistic):
    sum: float
    sum_squares: float

    @property
    def variance(self):
        return (self.sum_squares - pow(self.sum, 2) / self.n) / (self.n - 1)

    @property
    def mean(self):
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
        return self.sum / self.n


@dataclass
class RatioStatistic(Statistic):
    m_statistic: Union[SampleMeanStatistic, ProportionStatistic]
    d_statistic: Union[SampleMeanStatistic, ProportionStatistic]
    m_d_sum_of_products: float

    @property
    def mean(self):
        return self.m_statistic.sum / self.d_statistic.sum

    @property
    def variance(self):
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
        return (
            self.m_d_sum_of_products
            - self.m_statistic.sum * self.d_statistic.sum / self.n
        ) / (self.n - 1)


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
