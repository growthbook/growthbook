from typing import List, Optional, Union

from pydantic.dataclasses import dataclass
import pandas as pd

from gbstats.models.tests import ResponseCI
from gbstats.bayesian.tests import BayesianTestResult
from gbstats.frequentist.tests import TestResult, PValueErrorMessage


# Data classes for return to the back end
@dataclass
class SingleVariationResult:
    users: Optional[float]
    cr: Optional[float]
    ci: Optional[ResponseCI]


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


@dataclass
class FrequentistTestResult(TestResult):
    pValue: Optional[float]
    pValueErrorMessage: Optional[PValueErrorMessage]


@dataclass
class BayesianVariationResponseIndividual(BayesianTestResult, BaselineResponse):
    power: Optional[PowerResponse]


@dataclass
class FrequentistVariationResponseIndividual(FrequentistTestResult, BaselineResponse):
    power: Optional[PowerResponse] = None


VariationResponseIndividual = Union[
    BayesianVariationResponseIndividual,
    FrequentistVariationResponseIndividual,
    BaselineResponse,
]


@dataclass
class DimensionResponseIndividual:
    dimension: str
    srm: float
    variations: List[VariationResponseIndividual]

    def to_df(self) -> pd.DataFrame:
        df = pd.DataFrame(self.variations)
        df["dimension"] = self.dimension
        df["srm"] = self.srm
        return df


@dataclass
class BayesianVariationResponse(BayesianTestResult, BaselineResponse):
    power: Optional[PowerResponse]
    supplementalResultsCupedUnadjusted: Optional[BayesianTestResult]
    supplementalResultsUncapped: Optional[BayesianTestResult]
    supplementalResultsFlatPrior: Optional[BayesianTestResult]
    supplementalResultsUnstratified: Optional[BayesianTestResult]


@dataclass
class FrequentistVariationResponse(FrequentistTestResult, BaselineResponse):
    power: Optional[PowerResponse] = None
    supplementalResultsCupedUnadjusted: Optional[FrequentistTestResult] = None
    supplementalResultsUncapped: Optional[FrequentistTestResult] = None
    supplementalResultsUnstratified: Optional[FrequentistTestResult] = None


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
