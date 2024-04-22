from typing import List, Literal, Optional, Tuple, Union

from pydantic.dataclasses import dataclass

from gbstats.models.tests import Uplift


# Data classes for return to the back end
@dataclass
class MetricStats:
    users: int
    count: int
    stddev: float
    mean: float


@dataclass
class BaselineResponse:
    cr: float
    value: float
    users: float
    denominator: Optional[float]
    stats: MetricStats


@dataclass
class BaseVariationResponse(BaselineResponse):
    expected: float
    uplift: Uplift
    ci: Tuple[float, float]
    errorMessage: Optional[str]


@dataclass
class BayesianVariationResponse(BaseVariationResponse):
    chanceToWin: float
    risk: Tuple[float, float]
    riskType: Literal["absolute", "relative"]


@dataclass
class FrequentistVariationResponse(BaseVariationResponse):
    pValue: float


VariationResponse = Union[
    BayesianVariationResponse, FrequentistVariationResponse, BaselineResponse
]


@dataclass
class DimensionResponse:
    dimension: str
    srm: float
    variations: List[VariationResponse]


@dataclass
class ExperimentMetricAnalysisResult:
    unknownVariations: List[str]
    multipleExposures: float
    dimensions: List[DimensionResponse]


@dataclass
class ExperimentMetricAnalysis:
    metric: str
    analyses: List[ExperimentMetricAnalysisResult]
