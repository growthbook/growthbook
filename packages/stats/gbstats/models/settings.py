from typing import Any, Dict, List, Literal, Optional, Tuple, Union
from pydantic import ConfigDict
from pydantic.dataclasses import dataclass
from dataclasses import field
import numpy as np

# Types
DifferenceType = Literal["relative", "absolute", "scaled"]
StatsEngine = Literal["bayesian", "frequentist"]
StatisticType = Literal[
    "ratio", "ratio_ra", "mean", "mean_ra", "quantile_event", "quantile_unit"
]
MetricType = Literal["binomial", "count", "quantile"]
BusinessMetricType = Literal["goal", "guardrail", "secondary"]


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
    one_sided_intervals: bool = False
    post_stratification_enabled: bool = False


@dataclass
class BanditWeightsSinglePeriod:
    date: str
    weights: List[float]
    total_users: int  # sample size across all variations


@dataclass(config=ConfigDict(arbitrary_types_allowed=True))
class BanditSettingsForStatsEngine:
    var_names: List[str]
    var_ids: List[str]
    current_weights: List[float]
    reweight: bool = True
    decision_metric: str = ""
    bandit_weights_seed: int = 100
    bandit_weights_rng: np.random.Generator = field(
        default_factory=lambda: np.random.default_rng()
    )
    # we can delete the bottom two attributes, which are currently used in sim study testing
    weight_by_period: bool = True
    top_two: bool = False


# Context key: single context (str) or multi-dimension context (tuple of dimension values)
ContextKey = Union[str, Tuple[str, ...]]


@dataclass
class ContextualBanditSettingsForStatsEngine(BanditSettingsForStatsEngine):
    # default_factory so this subclass can add fields after BanditSettingsForStatsEngine's defaulted fields
    current_contextual_weights: Dict[ContextKey, List[float]] = field(
        default_factory=dict
    )
    contexts: List[str] = field(default_factory=list)


@dataclass
class ContextualTreeBanditSettingsForStatsEngine(
    ContextualBanditSettingsForStatsEngine
):
    max_leaf_nodes: int = 12


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


@dataclass
class ExperimentDataForStatsEngine:
    id: str
    data: Dict[str, Any]
