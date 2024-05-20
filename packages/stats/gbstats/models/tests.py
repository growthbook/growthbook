from abc import ABC, abstractmethod
from typing import List, Literal

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
    traffic_proportion_b: float = 1
    phase_length_days: float = 1
    cuped_type: Literal["pooled", "lin", "anova2", "anova20"] = "pooled"


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
        self.cuped_type = config.cuped_type
        
        # Ensure theta is set for regression adjusted statistics
        if isinstance(self.stat_b, RegressionAdjustedStatistic) and isinstance(
            self.stat_a, RegressionAdjustedStatistic
        ):
            if self.cuped_type == "pooled":
                theta = compute_theta(self.stat_a, self.stat_b)
                self.stat_a.pooled_pre_statistic_mean = 0
                self.stat_b.pooled_pre_statistic_mean = 0
                if theta == 0:
                    # revert to non-RA under the hood if no variance in a time period
                    self.stat_a = self.stat_a.post_statistic
                    self.stat_b = self.stat_b.post_statistic
                else:
                    self.stat_a.theta = theta
                    self.stat_b.theta = theta
            elif self.cuped_type == "lin":
                self.stat_a.theta = self.stat_a.covariance / self.stat_a.pre_statistic.variance
                self.stat_b.theta = self.stat_b.covariance / self.stat_b.pre_statistic.variance
                pooled_pre_mean = (self.stat_a.pre_statistic.sum + self.stat_b.pre_statistic.sum) / (self.stat_a.pre_statistic.n + self.stat_b.pre_statistic.n)
                self.stat_a.pooled_pre_statistic_mean = pooled_pre_mean
                self.stat_b.pooled_pre_statistic_mean = pooled_pre_mean
            elif self.cuped_type == "anova2":
                theta = (self.stat_a.covariance + self.stat_b.covariance) / (self.stat_a.pre_statistic.variance + self.stat_b.pre_statistic.variance)
                self.stat_a.theta = theta
                self.stat_b.theta = theta
                pooled_pre_mean = (self.stat_a.pre_statistic.sum + self.stat_b.pre_statistic.sum) / (self.stat_a.pre_statistic.n + self.stat_b.pre_statistic.n)
                self.stat_a.pooled_pre_statistic_mean = pooled_pre_mean
                self.stat_b.pooled_pre_statistic_mean = pooled_pre_mean
            elif self.cuped_type == "anova20":
                theta = (self.stat_a.covariance + self.stat_b.covariance) / (self.stat_a.pre_statistic.variance + self.stat_b.pre_statistic.variance)
                self.stat_a.theta = theta
                self.stat_b.theta = theta
                self.stat_a.pooled_pre_statistic_mean = 0
                self.stat_b.pooled_pre_statistic_mean = 0
            else:
                raise ValueError(f"Invalid cuped_type: {self.cuped_type}")


    def _has_zero_variance(self) -> bool:
        """Check if any variance is 0 or negative"""
        return self.stat_a._has_zero_variance or self.stat_b._has_zero_variance

    @abstractmethod
    def compute_result(self) -> TestResult:
        pass
