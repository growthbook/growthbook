from enum import Enum


class StatsEngine(Enum):
    BAYESIAN = "bayesian"
    FREQUENTIST = "frequentist"


class TimeSeries(Enum):
    NONE = "none"
    DAILY = "daily"
    CUMULATIVE = "cumulative"
