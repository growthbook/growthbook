from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List

import numpy as np
from scipy.stats import t


@dataclass
class Statistic:
    value: float
    standard_deviation: float
    n: int

    @property
    def variance(self) -> float:
        return pow(self.standard_deviation, 2)


@dataclass
class Proportion(Statistic):
    pass


@dataclass
class Mean(Statistic):
    pass


class TTest:
    def __init__(
        self,
        control_statistic: Statistic,
        treatment_statistic: Statistic,
        test_value: float = 0,
        alpha: float = 0.05,
    ):
        self.control_statistic = control_statistic
        self.treatment_statistic = treatment_statistic
        self.alpha = alpha
        self.test_value = test_value
        # TODO: validate same type of statistic

    @property
    def variance(self) -> float:
        return (
            self.treatment_statistic.variance / self.treatment_statistic.n
            + self.control_statistic.variance / self.control_statistic.n
        )

    @property
    def point_estimate(self) -> float:
        return self.treatment_statistic.value - self.control_statistic.value

    @property
    def critical_value(self) -> float:
        return (self.point_estimate - self.test_value) / np.sqrt(self.variance)

    @property
    def dof(self) -> int:
        # welch-satterthwaite approx (probably overkill)
        return pow(self.variance, 2) / (
            pow(self.treatment_statistic.variance / self.treatment_statistic.n, 2)
            / (self.treatment_statistic.n - 1)
            + pow(self.control_statistic.variance / self.control_statistic.n, 2)
            / (self.control_statistic.n - 1)
        )

    @property
    @abstractmethod
    def p_value(self) -> float:
        pass

    @property
    @abstractmethod
    def confidence_interval(self) -> List[float]:
        pass


class TwoSidedTTest(TTest):
    @property
    def p_value(self) -> float:
        return 2 * (1 - t.cdf(abs(self.critical_value), self.dof))

    @property
    def confidence_interval(self) -> List[float]:
        pass
        width: float = t.ppf(1 - self.alpha / 2, self.dof) * np.sqrt(self.variance)
        return [self.point_estimate - width, self.point_estimate + width]


class OneSidedTreatmentGreaterTTest(TTest):
    @property
    def p_value(self) -> float:
        return 1 - t.cdf(self.critical_value, self.dof)

    @property
    def confidence_interval(self) -> List[float]:
        width: float = t.ppf(1 - self.alpha, self.dof) * np.sqrt(self.variance)
        return [self.point_estimate - width, np.inf]


class OneSidedTreatmentLesserTTest(TTest):
    @property
    def p_value(self) -> float:
        return t.cdf(self.critical_value, self.dof)

    @property
    def confidence_interval(self) -> List[float]:
        width: float = t.ppf(1 - self.alpha, self.dof) * np.sqrt(self.variance)
        return [-np.inf, self.point_estimate - width]


# TODO extend to sequential TTests
