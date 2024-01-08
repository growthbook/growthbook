from enum import Enum


# Change repr to make generating notebooks easier
class GBEnum(Enum):
    def __repr__(self):
        cls_name = self.__class__.__name__
        return f"{cls_name}.{self.name}"


class StatsEngine(GBEnum):
    BAYESIAN = "bayesian"
    FREQUENTIST = "frequentist"


class DifferenceType(GBEnum):
    RELATIVE = "relative"
    ABSOLUTE = "absolute"
    SCALED = "scaled"


class StatisticType(GBEnum):
    MEAN = "mean"
    RATIO = "ratio"
    MEAN_RA = "mean_ra"


class MetricType(GBEnum):
    COUNT = "count"
    BINOMIAL = "binomial"
