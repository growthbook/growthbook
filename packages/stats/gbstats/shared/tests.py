from abc import ABC, abstractmethod

from gbstats.shared.models import Statistic, TestResult


class BaseABTest(ABC):
    def __init__(
        self,
        stat_a: Statistic,
        stat_b: Statistic,
    ):
        self.stat_a = stat_a
        self.stat_b = stat_b

    def _is_variance_positive(self) -> bool:
        """Check if all standard deviations are positive"""
        return self.stat_a.variance > 0 and self.stat_b.variance > 0

    @abstractmethod
    def compute_result(self) -> TestResult:
        pass
