from gbstats.shared.constants import StatsEngine
from gbstats.shared.models import RegressionAdjustedStatistic, Statistic


RA_NOT_COMPATIBLE_WITH_BAYESIAN_ERROR = (
    "RegressionAdjustedStatistic cannot be used with the Bayesian statistics engine"
)


# Raises error if bayesian engine and regression adjustment used together
def raise_error_if_bayesian_ra(stat: Statistic, engine: StatsEngine):
    if isinstance(stat, RegressionAdjustedStatistic) and engine == StatsEngine.BAYESIAN:
        raise ValueError(RA_NOT_COMPATIBLE_WITH_BAYESIAN_ERROR)


# Default stats response error messages
NO_UNITS_IN_VARIATION_MESSAGE = "NO_UNITS_IN_VARIATION"
ZERO_NEGATIVE_VARIANCE_MESSAGE = "ZERO_NEGATIVE_VARIANCE"
LOG_APPROXIMATION_INEXACT_MESSAGE = "LOG_APPROXIMATION_INEXACT"
BASELINE_VARIATION_ZERO_MESSAGE = "ZERO_NEGATIVE_BASELINE_VARIATION"
ZERO_SCALED_VARIATION_MESSAGE = "ZERO_SCALED_VARIATION_WEIGHT"
