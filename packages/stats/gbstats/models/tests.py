from abc import ABC, abstractmethod
from typing import List, Optional

from pydantic.dataclasses import dataclass

from gbstats.models.statistics import (
    RegressionAdjustedStatistic,
    TestStatistic,
    compute_theta,
)
from gbstats.models.settings import DifferenceType


# Configs
@dataclass
class BaseConfig:
    difference_type: DifferenceType = "relative"
    traffic_percentage: float = 1
    phase_length_days: float = 1
    total_users: Optional[int] = None
    alpha: float = 0.05


# Results
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


# Tests
class BaseABTest(ABC):
    def __init__(
        self,
        stat_a: TestStatistic,
        stat_b: TestStatistic,
        config: BaseConfig = BaseConfig(),
    ):
        self.stat_a = stat_a
        self.stat_b = stat_b
        if isinstance(stat_a, RegressionAdjustedStatistic):
            if not isinstance(stat_b, RegressionAdjustedStatistic):
                raise ValueError(
                    "If stat_a is a RegressionAdjustedStatistic, stat_b must be as well"
                )
        if isinstance(stat_b, RegressionAdjustedStatistic):
            if not isinstance(stat_a, RegressionAdjustedStatistic):
                raise ValueError(
                    "If stat_b is a RegressionAdjustedStatistic, stat_a must be as well"
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

    def _has_zero_variance(self) -> bool:
        """Check if any variance is 0 or negative"""
        return self.stat_a._has_zero_variance or self.stat_b._has_zero_variance

    @abstractmethod
    def compute_result(self) -> TestResult:
        pass
