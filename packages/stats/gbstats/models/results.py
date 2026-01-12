from typing import List, Optional, Tuple, Union

from pydantic.dataclasses import dataclass
import pandas as pd

from gbstats.bayesian.tests import RiskType
from gbstats.frequentist.tests import PValueErrorMessage
from gbstats.models.tests import Uplift


# Data classes for return to the back end
@dataclass
class RealizedSettings:
    postStratificationApplied: bool


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
    status: str
    errorMessage: Optional[str]
    firstPeriodPairwiseSampleSize: Optional[float]
    targetMDE: float
    sigmahat2Delta: Optional[float]
    priorProper: Optional[bool]
    priorLiftMean: Optional[float]
    priorLiftVariance: Optional[float]
    upperBoundAchieved: Optional[bool]
    scalingFactor: Optional[float]


ResponseCI = Tuple[Optional[float], Optional[float]]


@dataclass
class BaseVariationResponse(BaselineResponse):
    expected: float
    uplift: Uplift
    ci: ResponseCI
    errorMessage: Optional[str]
    power: Optional[PowerResponse]
    realizedSettings: RealizedSettings


@dataclass
class BayesianVariationResponse(BaseVariationResponse):
    chanceToWin: float
    risk: Tuple[float, float]
    riskType: RiskType


@dataclass
class FrequentistVariationResponse(BaseVariationResponse):
    pValue: Optional[float]
    pValueErrorMessage: Optional[PValueErrorMessage]


VariationResponse = Union[
    BayesianVariationResponse, FrequentistVariationResponse, BaselineResponse
]


@dataclass
class DimensionResponse:
    dimension: str
    srm: float
    variations: List[VariationResponse]

    def to_df(self) -> pd.DataFrame:
        df = pd.DataFrame(self.variations)
        df["variation"] = df.index
        df["dimension"] = self.dimension
        df["srm"] = self.srm
        return df


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
