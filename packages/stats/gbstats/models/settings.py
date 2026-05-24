import dataclasses
from typing import Any, Dict, List, Literal, Optional, Union
from pydantic import ConfigDict
from pydantic.dataclasses import dataclass
from dataclasses import field
import numpy as np

# Types
DifferenceType = Literal["relative", "absolute", "scaled"]
StatsEngine = Literal["bayesian", "frequentist"]
UnadjustedStatisticType = Literal["ratio", "mean", "quantile_event", "quantile_unit"]
RegressionAdjustedStatisticType = Literal["ratio_ra", "mean_ra"]
StatisticType = Union[UnadjustedStatisticType, RegressionAdjustedStatisticType]
MetricType = Literal["binomial", "count", "quantile"]
BusinessMetricType = Literal["goal", "guardrail", "secondary"]


CONTEXTUAL_BANDIT_DIMENSION_COLUMN = "dimension"
CONTEXTUAL_BANDIT_DIMENSION_VALUE = "All"


@dataclass
class AnalysisSettingsForStatsEngine:
    var_names: List[str]
    var_ids: List[str]
    weights: List[float]
    baseline_index: int = 0
    dimension: str = ""
    stats_engine: StatsEngine = "bayesian"
    p_value_corrected: bool = False
    sequential_testing_enabled: bool = False
    sequential_tuning_parameter: float = 5000
    difference_type: DifferenceType = "relative"
    phase_length_days: float = 1
    alpha: float = 0.05
    max_dimensions: int = 20
    traffic_percentage: float = 1
    num_goal_metrics: int = 1
    num_guardrail_metrics: int = 0
    one_sided_intervals: bool = False
    use_covariate_as_response: bool = False
    post_stratification_enabled: bool = False


@dataclass
class BanditWeightsSinglePeriod:
    date: str
    weights: List[float]
    total_users: int  # sample size across all variations


_config = ConfigDict(arbitrary_types_allowed=True)


@dataclass(config=ConfigDict(arbitrary_types_allowed=True))
class BanditSettingsForStatsEngine:
    var_names: List[str]
    var_ids: List[str]
    current_weights: List[float]
    reweight: bool = True
    decision_metric: str = ""
    bandit_weights_rng: np.random.Generator = field(
        default_factory=lambda: np.random.default_rng()
    )
    # we can delete the bottom two attributes, which are currently used in sim study testing
    weight_by_period: bool = True
    top_two: bool = False


@dataclass(config=ConfigDict(arbitrary_types_allowed=True))
class ContextualBanditSettingsForStatsEngine(BanditSettingsForStatsEngine):
    var_names: List[str]
    var_ids: List[str]
    reweight: bool = True
    decision_metric: str = ""
    bandit_weights_rng: np.random.Generator = field(
        default_factory=lambda: np.random.default_rng()
    )
    # we can delete the next two attributes, which are currently used in sim study testing
    weight_by_period: bool = True
    top_two: bool = False
    attributes: List[str] = field(
        default_factory=list
    )  # columns that are used to create context keys; not column values
    max_leaves: int = 12

    def __post_init__(self):
        if not self.attributes:
            raise ValueError("attributes must be non-empty")


ExperimentMetricQueryResponseRows = List[Dict[str, Union[str, int, float]]]
VarIdMap = Dict[str, int]


@dataclass
class QueryResultsForStatsEngine:
    rows: ExperimentMetricQueryResponseRows
    metrics: List[Optional[str]]
    sql: Optional[str] = None


@dataclass
class MetricSettingsForStatsEngine:
    id: str
    name: str
    statistic_type: StatisticType
    main_metric_type: MetricType
    inverse: bool = False
    prior_proper: bool = False
    prior_mean: float = 0
    prior_stddev: float = 0.1
    keep_theta: bool = False
    denominator_metric_type: Optional[MetricType] = None
    covariate_metric_type: Optional[MetricType] = None
    quantile_value: Optional[float] = None
    business_metric_type: Optional[List[BusinessMetricType]] = None
    target_mde: float = 0.01
    compute_uncapped_metric: bool = False


@dataclass
class DataForStatsEngine:
    metrics: Dict[str, MetricSettingsForStatsEngine]
    analyses: List[AnalysisSettingsForStatsEngine]
    query_results: List[QueryResultsForStatsEngine]
    bandit_settings: Optional[BanditSettingsForStatsEngine]
    contextual_bandit_settings: Optional[ContextualBanditSettingsForStatsEngine]


@dataclass
class ExperimentDataForStatsEngine:
    id: str
    data: Dict[str, Any]


def get_bandit_settings(data: Dict[str, Any]) -> Optional[BanditSettingsForStatsEngine]:
    """Build :class:`BanditSettingsForStatsEngine` from the stats-engine payload.

    Copies every field defined on :class:`BanditSettingsForStatsEngine` from
    ``data["bandit_settings"]`` except ``bandit_weights_rng``, which is always set to
    :func:`numpy.random.default_rng` using ``bandit_weights_seed`` from that dict
    (default ``100`` if the seed is omitted). Extra keys in the payload (e.g.
    ``historical_weights`` from the API) are ignored.
    """
    if "bandit_settings" not in data or data["bandit_settings"] is None:
        return None
    raw = dict(data["bandit_settings"])
    allowed = {f.name for f in dataclasses.fields(BanditSettingsForStatsEngine)}
    kwargs = {
        k: v for k, v in raw.items() if k in allowed and k != "bandit_weights_rng"
    }
    seed = int(raw.get("bandit_weights_seed", 100))
    kwargs["bandit_weights_rng"] = np.random.default_rng(seed)
    return BanditSettingsForStatsEngine(**kwargs)


def get_contextual_bandit_settings(
    data: Dict[str, Any],
) -> Optional[ContextualBanditSettingsForStatsEngine]:
    """Build :class:`ContextualBanditSettingsForStatsEngine` from ``data["contextual_bandit_settings"]``."""
    raw_payload = data.get("contextual_bandit_settings")
    if raw_payload is None:
        return None
    raw = dict(raw_payload)
    allowed = {
        f.name for f in dataclasses.fields(ContextualBanditSettingsForStatsEngine)
    }
    kwargs = {
        k: v for k, v in raw.items() if k in allowed and k != "bandit_weights_rng"
    }
    seed = int(raw.get("bandit_weights_seed", 100))
    kwargs["bandit_weights_rng"] = np.random.default_rng(seed)
    kwargs.setdefault("current_contextual_weights", {})
    try:
        return ContextualBanditSettingsForStatsEngine(**kwargs)
    except (TypeError, ValueError):
        return None
