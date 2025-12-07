from typing import List, Optional, Tuple, Union

from pydantic.dataclasses import dataclass
import pandas as pd

from gbstats.bayesian.tests import RiskType, BayesianTestResult
from gbstats.frequentist.tests import PValueErrorMessage, FrequentistTestResult
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
class BaseExperimentResults:
    expected: float
    uplift: Uplift
    ci: ResponseCI
    errorMessage: Optional[str]


# TODO: talk to Sonnet about better way to handle defaults
@dataclass
class TestResultNoDefaults:
    expected: float
    ci: List[float]
    uplift: Uplift
    errorMessage: Optional[str]


@dataclass
class BayesianTestResultNoDefaults(TestResultNoDefaults):
    chanceToWin: float
    risk: List[float]
    riskType: RiskType


@dataclass
class FrequentistTestResultNoDefaults(TestResultNoDefaults):
    pValue: Optional[float]
    pValueErrorMessage: Optional[PValueErrorMessage]


def create_test_result_no_defaults_bayesian(
    test_result: BayesianTestResult,
) -> BayesianTestResultNoDefaults:
    return BayesianTestResultNoDefaults(
        expected=test_result.expected,
        ci=test_result.ci,
        uplift=test_result.uplift,
        errorMessage=test_result.error_message,
        chanceToWin=test_result.chance_to_win,
        risk=test_result.risk,
        riskType=test_result.risk_type,
    )


def create_test_result_no_defaults_frequentist(
    test_result: FrequentistTestResult,
) -> FrequentistTestResultNoDefaults:
    return FrequentistTestResultNoDefaults(
        expected=test_result.expected,
        ci=test_result.ci,
        uplift=test_result.uplift,
        errorMessage=test_result.error_message,
        pValue=test_result.p_value if test_result.p_value else None,
        pValueErrorMessage=test_result.p_value_error_message,
    )


@dataclass
class BayesianVariationResponse(BaselineResponse, BayesianTestResultNoDefaults):
    power: Optional[PowerResponse]
    supplementalResultsCupedUnadjusted: Optional[BayesianTestResultNoDefaults]
    supplementalResultsUncapped: Optional[BayesianTestResultNoDefaults]
    supplementalResultsFlatPrior: Optional[BayesianTestResultNoDefaults]
    supplementalResultsUnstratified: Optional[BayesianTestResultNoDefaults]


@dataclass
class FrequentistVariationResponse(BaselineResponse, FrequentistTestResultNoDefaults):
    power: Optional[PowerResponse]
    supplementalResultsCupedUnadjusted: Optional[FrequentistTestResultNoDefaults]
    supplementalResultsUncapped: Optional[FrequentistTestResultNoDefaults]
    supplementalResultsUnstratified: Optional[FrequentistTestResultNoDefaults]


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
