from typing import List, Optional, Tuple, Union

from pydantic.dataclasses import dataclass

from gbstats.bayesian.tests import RiskType
from gbstats.models.tests import Uplift


# Data classes for return to the back end
@dataclass
class SingleVariationResult:
    users: Optional[float]
    cr: Optional[float]
    ci: Optional[List[float]]


@dataclass
class BanditResult:
    singleVariationResults: Optional[List[SingleVariationResult]]
    currentWeights: Optional[List[float]]
    updatedWeights: Optional[List[float]]
    srm: Optional[float]
    bestArmProbabilities: Optional[List[float]]
    seed: int
    updateMessage: Optional[str]
    error: Optional[str]
    reweight: bool
    weightsWereUpdated: bool


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
class PowerResponse:
    firstPeriodPairwiseSampleSize: float
    minPercentChange: float
    sigmahat2Delta: float
    sigma2Posterior: float
    deltaPosterior: float
    powerUpdateMessage: str
    powerError: Optional[str]
    upperBoundAchieved: bool
    scalingFactor: float
    endOfExperimentPower: Optional[float]  # delete later, used for testing only
    newDailyUsers: Optional[float]  # delete later, used for testing only
    additionalUsers: Optional[float]  # delete later, used for testing only
    targetPower: float  # delete later, used for testing only


@dataclass
class BaseVariationResponse(BaselineResponse):
    expected: float
    uplift: Uplift
    ci: Tuple[float, float]
    errorMessage: Optional[str]
    power: Optional[PowerResponse]


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


@dataclass
class MultipleExperimentMetricAnalysis:
    id: str
    results: List[ExperimentMetricAnalysis]
    banditResult: Optional[BanditResult]
    error: Optional[str]
    traceback: Optional[str]
