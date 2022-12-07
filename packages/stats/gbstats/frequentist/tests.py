from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List

import numpy as np
from scipy.stats import t

from gbstats.shared.models import FrequentistTestResult, Statistic, Uplift
from gbstats.shared.tests import BaseABTest


class TTest(BaseABTest):
    def __init__(
        self,
        stat_a: Statistic,
        stat_b: Statistic,
        test_value: float = 0,
        alpha: float = 0.05,
    ):
        super().__init__(stat_a, stat_b)
        self.alpha = alpha
        self.test_value = test_value
        # TODO: validate same type of statistic

    @property
    def variance(self) -> float:
        return (
            self.stat_b.variance / self.stat_b.n + self.stat_a.variance / self.stat_a.n
        )

    @property
    def point_estimate(self) -> float:
        return self.stat_b.value - self.stat_a.value

    @property
    def critical_value(self) -> float:
        return (self.point_estimate - self.test_value) / np.sqrt(self.variance)

    @property
    def dof(self) -> int:
        # welch-satterthwaite approx (probably overkill)
        return pow(self.variance, 2) / (
            pow(self.stat_b.variance / self.stat_b.n, 2) / (self.stat_b.n - 1)
            + pow(self.stat_a.variance / self.stat_a.n, 2) / (self.stat_a.n - 1)
        )

    @property
    @abstractmethod
    def p_value(self) -> float:
        pass

    @property
    @abstractmethod
    def confidence_interval(self) -> List[float]:
        pass

    def compute_result(self) -> FrequentistTestResult:
        return FrequentistTestResult(
            expected=self.point_estimate,
            # have to make CI about percent as well for x-axis
            ci=[x / self.stat_a.value for x in self.confidence_interval],
            p_value=self.p_value,
            uplift=Uplift(
                dist="normal",
                mean=self.point_estimate / self.stat_a.value,
                stddev=np.sqrt(self.variance) / self.stat_a.value,
            ),
        )


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
