from typing import Dict, List, Literal, Optional, Union

from pydantic.dataclasses import dataclass

# Types
DifferenceType = Literal["relative", "absolute", "scaled"]
StatsEngine = Literal["bayesian", "frequentist"]
StatisticType = Literal["ratio", "mean", "mean_ra"]
MetricType = Literal["binomial", "count"]


@dataclass
class AnalysisSettingsForStatsEngine:
    var_names: List[str]
    weights: List[float]
    baseline_index: int = 0
    dimension: str = ""
    stats_engine: StatsEngine = "bayesian"
    sequential_testing_enabled: bool = False
    sequential_tuning_parameter: float = 5000
    difference_type: DifferenceType = "relative"
    phase_length_days: float = 1
    alpha: float = 0.05
    max_dimensions: int = 20


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
    denominator_metric_type: Optional[MetricType] = None
    covariate_metric_type: Optional[MetricType] = None


@dataclass
class DataForStatsEngine:
    var_id_map: VarIdMap
    metrics: Dict[str, MetricSettingsForStatsEngine]
    analyses: List[AnalysisSettingsForStatsEngine]
    query_results: List[QueryResultsForStatsEngine]
