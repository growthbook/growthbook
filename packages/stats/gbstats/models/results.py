from typing import List, Optional, Tuple, Union

from pydantic.dataclasses import dataclass

from gbstats.bayesian.tests import RiskType
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
    riskType: RiskType


@dataclass
class FrequentistVariationResponse(BaseVariationResponse):
    pValue: float


VariationResponse = Union[
    BayesianVariationResponse, FrequentistVariationResponse, BaselineResponse
]


@dataclass
class BanditResponse:
    banditWeights: Optional[float]
    banditErrorMessage: Optional[str]


@dataclass
class DimensionResponse:
    dimension: str
    srm: float
    variations: List[VariationResponse]
    bandit: Optional[BanditResponse]


@dataclass
class ExperimentMetricAnalysisResult:
    unknownVariations: List[str]
    multipleExposures: float
    dimensions: List[DimensionResponse]


@dataclass
class ExperimentMetricAnalysis:
    metric: str
    analyses: List[ExperimentMetricAnalysisResult]
