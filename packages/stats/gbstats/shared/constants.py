from enum import Enum


class StatsEngine(Enum):
    BAYESIAN = "bayesian"
    FREQUENTIST = "frequentist"


class DifferenceType(Enum):
    RELATIVE = "relative"
    ABSOLUTE = "absolute"
    SCALED = "scaled"
