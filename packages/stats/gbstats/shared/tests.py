from abc import ABC, abstractmethod

from gbstats.shared.models import TestStatistic, TestResult


class BaseABTest(ABC):
    def __init__(
        self,
        stat_a: TestStatistic,
        stat_b: TestStatistic,
    ):
        self.stat_a = stat_a
        self.stat_b = stat_b

    def _has_zero_variance(self) -> bool:
        """Check if any variance is 0 or negative"""
        return self.stat_a.variance <= 0 or self.stat_b.variance <= 0

    @abstractmethod
    def compute_result(self) -> TestResult:
        pass
