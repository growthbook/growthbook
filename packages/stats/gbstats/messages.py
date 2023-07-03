from gbstats.shared.constants import StatsEngine
from gbstats.shared.models import RegressionAdjustedStatistic, Statistic


RA_NOT_COMPATIBLE_WITH_BAYESIAN_ERROR = (
    "RegressionAdjustedStatistic cannot be used with the Bayesian statistics engine"
)


# Raises error if bayesian engine and regression adjustment used together
def raise_error_if_bayesian_ra(regression_adjusted: bool, engine: StatsEngine):
    if regression_adjusted and engine == StatsEngine.BAYESIAN:
        raise ValueError("RegressionAdjustedStatistic cannot be used with the Bayesian statistics engine")
