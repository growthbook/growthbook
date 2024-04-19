from abc import ABC, abstractmethod
from typing import List

from pydantic.dataclasses import dataclass

from gbstats.models.statistics import TestStatistic
from gbstats.models.settings import DifferenceType


# Configs
@dataclass
class BaseConfig:
    difference_type: DifferenceType = "relative"
    traffic_proportion_b: float = 1
    phase_length_days: float = 1


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

    def _has_zero_variance(self) -> bool:
        """Check if any variance is 0 or negative"""
        return self.stat_a._has_zero_variance or self.stat_b._has_zero_variance

    @abstractmethod
    def compute_result(self) -> TestResult:
        pass
