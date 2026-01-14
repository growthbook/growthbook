from typing import List, Literal, Optional, Tuple, Union

from pydantic.dataclasses import dataclass
import pandas as pd


# Internal results classes
@dataclass
class EffectMomentsResult:
    point_estimate: float
    standard_error: float
    pairwise_sample_size: int
    error_message: Optional[str]
    post_stratification_applied: bool


@dataclass
class Uplift:
    dist: str
    mean: float
    stddev: float


@dataclass
class TestResult:
    expected: float
    ci: List[float]
    uplift: Uplift
    error_message: Optional[str]


RiskType = Literal["absolute", "relative"]


@dataclass
class BayesianTestResult(TestResult):
    chance_to_win: float
    risk: List[float]
    risk_type: RiskType


PValueErrorMessage = Literal[
    "NUMERICAL_PVALUE_NOT_CONVERGED",
    "ALPHA_GREATER_THAN_0.5_FOR_SEQUENTIAL_ONE_SIDED_TEST",
]


@dataclass
class FrequentistTestResult(TestResult):
    p_value: Optional[float] = None
    p_value_error_message: Optional[PValueErrorMessage] = None


@dataclass
class PValueResult:
    p_value: Optional[float] = None
    p_value_error_message: Optional[PValueErrorMessage] = None


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
