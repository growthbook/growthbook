from abc import ABC, abstractmethod

from gbstats.shared.models import TestResult
from gbstats.shared.models import Statistic


class BaseABTest(ABC):
    def __init__(
        self,
        stat_a: Statistic,
        stat_b: Statistic,
    ):
        self.stat_a = stat_a
        self.stat_b = stat_b

    @abstractmethod
    def compute_result(self) -> TestResult:
        pass
