from dataclasses import dataclass
from typing import List

from gbstats.shared.constants import DifferenceType

# Data class for test config
@dataclass
class BaseConfig:
    difference_type: DifferenceType = DifferenceType.RELATIVE
    traffic_proportion_b: float = 1
    phase_length_days: float = 1


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


@dataclass
class FrequentistTestResult(TestResult):
    p_value: float
