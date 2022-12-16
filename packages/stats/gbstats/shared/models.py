from dataclasses import dataclass
from typing import List, Optional

import pandas as pd


# For now this dataclass is a bit unwieldy to hold inputs from sql
@dataclass
class Statistic:
    value: float
    stddev: float
    count: int
    n: int

    @property
    def variance(self) -> float:
        return pow(self.stddev, 2)


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
