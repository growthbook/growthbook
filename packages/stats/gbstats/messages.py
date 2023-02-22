from gbstats.shared.constants import StatsEngine
from gbstats.shared.models import RegressionAdjustedStatistic, Statistic


# Raises error if bayesian engine and regression adjustment used together
def raise_error_if_bayesian_ra(stat: Statistic, engine: StatsEngine):
    if isinstance(stat, RegressionAdjustedStatistic) and engine == StatsEngine.Bayesian:
        raise ValueError(
            "RegressionAdjustedStatistic cannot be used with the Bayesian statistics engine"
        )
