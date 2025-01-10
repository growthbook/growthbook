import { ExperimentSnapshotTraffic } from "back-end/types/experiment-snapshot";
import { eachDayOfInterval, formatISO, subDays } from "date-fns";
import normal from "@stdlib/stats/base/dists/normal";
import { OrganizationSettings } from "back-end/types/organization";
import { MetricPriorSettings } from "back-end/types/fact-table";
import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import { MetricPowerResponseFromStatsEngine } from "back-end/types/stats";

export interface MetricParamsBase {
  name: string;
  effectSize: number;
  overrideMetricLevelSettings: boolean;
  overridePriorLiftMean: number;
  overridePriorLiftStandardDeviation: number;
  overrideProper: boolean;
  metricPriorLiftMean: number;
  metricPriorLiftStandardDeviation: number;
  metricProper: boolean;
}

export interface MetricParamsMean extends MetricParamsBase {
  type: "mean";
  mean: number;
  standardDeviation: number;
}

export interface MetricParamsBinomial extends MetricParamsBase {
  type: "binomial";
  conversionRate: number;
}

export type MetricParams = MetricParamsMean | MetricParamsBinomial;

export interface StatsEngineSettings {
  type: "frequentist" | "bayesian";
  sequentialTesting: false | number;
}

export interface PowerCalculationParams {
  metrics: { [id: string]: MetricParams };
  nVariations: number;
  nWeeks: number;
  alpha: number;
  usersPerWeek: number;
  targetPower: number;
  statsEngineSettings: StatsEngineSettings;
}

export type FullModalPowerCalculationParams = Omit<
  PowerCalculationParams,
  "nVariations" | "statsEngine"
>;

// Partial on all key except name and type.
export type PartialMetricParams =
  | (Partial<Omit<MetricParamsMean, "name" | "type">> & {
      name: string;
      type: "mean";
    })
  | (Partial<Omit<MetricParamsBinomial, "name" | "type">> & {
      name: string;
      type: "binomial";
    });

export type PartialPowerCalculationParams = Partial<
  Omit<FullModalPowerCalculationParams, "metrics">
> & {
  metrics: {
    [id: string]: PartialMetricParams;
  };
};

type Config = {
  // Config with no title are not displayed by default!
  title?: string;
  metricType?: "all" | "mean" | "binomial";
  tooltip?: string;
} & (
  | {
      type: "percent" | "number";
      minValue?: number;
      maxValue?: number;
      defaultSettingsValue?: (
        priorSettings: MetricPriorSettings | undefined,
        orgSettings: OrganizationSettings
      ) => number | undefined;
      defaultValue?: number;
    }
  | {
      type: "boolean";
      defaultSettingsValue?: (
        priorSettings: MetricPriorSettings | undefined,
        orgSettings: OrganizationSettings
      ) => boolean | undefined;
      defaultValue?: boolean;
    }
);

const checkConfig = <T extends string>(config: { [id in T]: Config }) => config;

export const config = checkConfig({
  usersPerWeek: {
    title: "Users Per Day",
    type: "number",
    minValue: 0,
  },
  effectSize: {
    title: "Effect Size",
    type: "percent",
    tooltip:
      "This is the relative effect size that you anticipate for your experiment. Setting this allows us to compute the number of weeks needed to reliably detect an effect of this size or larger.",
    minValue: 0,
    defaultValue: 0.01,
  },
  mean: {
    title: "Mean",
    metricType: "mean",
    type: "number",
  },
  standardDeviation: {
    title: "Standard Deviation",
    metricType: "mean",
    type: "number",
    minValue: 0,
  },
  conversionRate: {
    title: "Conversion Rate",
    metricType: "binomial",
    type: "percent",
    minValue: 0,
    maxValue: 1,
  },
  overrideMetricLevelSettings: {
    title: "Override metric-level settings",
    metricType: "all",
    type: "boolean",
    defaultValue: false,
  },
  overrideProper: {
    title: "Use proper prior",
    metricType: "all",
    type: "boolean",
    defaultSettingsValue: (priorSettings, s) =>
      priorSettings?.override
        ? priorSettings.proper
        : s.metricDefaults?.priorSettings?.proper,
    defaultValue: false,
  },
  overridePriorLiftMean: {
    title: "Prior Mean",
    metricType: "all",
    type: "percent",
    tooltip: "Prior mean for the relative effect size.",
    defaultSettingsValue: (priorSettings, s) =>
      priorSettings?.override
        ? priorSettings.mean
        : s.metricDefaults?.priorSettings?.mean,
    defaultValue: 0,
  },
  overridePriorLiftStandardDeviation: {
    title: "Prior Standard Deviation",
    metricType: "all",
    type: "percent",
    tooltip: "Prior standard deviation for the relative effect size.",
    minValue: 0,
    defaultSettingsValue: (priorSettings, s) =>
      priorSettings?.override
        ? priorSettings.stddev
        : s.metricDefaults?.priorSettings?.stddev,
    defaultValue: DEFAULT_PROPER_PRIOR_STDDEV,
  },
  metricProper: {
    metricType: "all",
    type: "boolean",
    defaultSettingsValue: (priorSettings, s) =>
      priorSettings?.override
        ? priorSettings.proper
        : s.metricDefaults?.priorSettings?.proper,
    defaultValue: false,
  },
  metricPriorLiftMean: {
    metricType: "all",
    type: "percent",
    tooltip: "Prior mean for the relative effect size.",
    defaultSettingsValue: (priorSettings, s) =>
      priorSettings?.override
        ? priorSettings.mean
        : s.metricDefaults?.priorSettings?.mean,
    defaultValue: 0,
  },
  metricPriorLiftStandardDeviation: {
    metricType: "all",
    type: "percent",
    tooltip: "Prior standard deviation for the relative effect size.",
    minValue: 0,
    defaultSettingsValue: (priorSettings, s) =>
      priorSettings?.override
        ? priorSettings.stddev
        : s.metricDefaults?.priorSettings?.stddev,
    defaultValue: DEFAULT_PROPER_PRIOR_STDDEV,
  },
});

const validEntry = (
  name: keyof typeof config,
  v: number | boolean | undefined
) => {
  if (v === undefined) return false;

  const c = config[name];
  if (c.type === "boolean") return typeof v === "boolean";

  if (typeof v !== "number") return false;

  if (isNaN(v)) return false;

  const { maxValue, minValue } = c;

  if (minValue !== undefined && v <= minValue) return false;
  if (maxValue !== undefined && maxValue < v) return false;

  return true;
};

export const isValidPowerCalculationParams = (
  engineType: "frequentist" | "bayesian",
  v: PartialPowerCalculationParams
): v is FullModalPowerCalculationParams =>
  validEntry("usersPerWeek", v.usersPerWeek) &&
  Object.keys(v.metrics).every((key) => {
    const params = v.metrics[key];
    if (!params) return false;

    const commonParams = ["effectSize"] as const;
    const bayesianEngineParams = [
      "overrideProper",
      "overridePriorLiftMean",
      "overridePriorLiftStandardDeviation",
      "metricProper",
      "metricPriorLiftMean",
      "metricPriorLiftStandardDeviation",
    ] as const;
    const binomialParams = ["conversionRate"] as const;
    const meanParams = ["mean", "standardDeviation"] as const;

    return ([
      ...commonParams,
      ...(engineType === "bayesian" ? bayesianEngineParams : []),
      // In separate statements to help the type checker.
      ...(params.type === "binomial" ? binomialParams : []),
      ...(params.type === "mean" ? meanParams : []),
    ] as const).every((k) => validEntry(k, params[k]));
  });

export const ensureAndReturnPowerCalculationParams = (
  engineType: "frequentist" | "bayesian",
  v: PartialPowerCalculationParams
): FullModalPowerCalculationParams => {
  if (!isValidPowerCalculationParams(engineType, v)) throw "internal error";
  return v;
};

export interface SampleSizeAndRuntime {
  weeks: number;
  users: number;
}

export interface Week {
  users: number;
  metrics: {
    [id: string]: {
      isThreshold: boolean;
      effectSize: number;
      power: number;
    };
  };
}

export type MDEResults =
  | {
      type: "success";
      mde: number;
    }
  | {
      type: "error";
      description: string;
    };

export interface MidExperimentPowerMultipleMetricsParams {
  sequential: boolean;
  alpha: number;
  sequentialTuningParameter: number;
  daysRemaining: number;
  firstPeriodSampleSize: number;
  numGoalMetrics: number;
  variationWeights: number[];
  variations: MidExperimentSingleVariationParams[];
}

export interface MidExperimentPowerSingleMetricsParams {
  sequential: boolean;
  alpha: number;
  sequentialTuningParameter: number;
  daysRemaining: number;
  firstPeriodSampleSize: number;
  numGoalMetrics: number;
  variationWeights: number[];
  numVariations: number;
  variation: MidExperimentSingleVariationParams;
}

export interface MidExperimentSingleVariationParams {
  // For a single variation, we need to know the power for each metric.
  metrics: {
    [metricId: string]: MetricPowerResponseFromStatsEngine;
  };
}

export type PowerCalculationSuccessResults = {
  type: "success";
  sampleSizeAndRuntime: {
    [id: string]: SampleSizeAndRuntime | undefined;
  };
  weeks: Week[];
  weekThreshold?: number;
};

export type PowerCalculationResults =
  | PowerCalculationSuccessResults
  | {
      type: "error";
      description: string;
    };

export type MetricVariationPowerResult = {
  newDailyUsers?: number;
  metricId: string;
  variation: number;
  effectSize?: number;
  power?: number;
  lowPowerWarning?: boolean;
  additionalDays?: number;
  calculationSucceeded: boolean;
  errorMessage?: string;
};

export type MidExperimentPowerCalculationFailureResult = {
  type: "error";
  lowPowerWarning: boolean;
  metricVariationPowerResults: MetricVariationPowerResult[];
};

export type MidExperimentPowerCalculationSuccessResult = {
  type: "success";
  power: number;
  additionalUsers: number;
  additionalDays: number;
  lowPowerWarning: boolean;
  metricVariationPowerResults: MetricVariationPowerResult[];
};

export type MidExperimentPowerCalculationResult =
  | MidExperimentPowerCalculationSuccessResult
  | MidExperimentPowerCalculationFailureResult;

/**
 * delta method for relative difference
 *
 * @param varA Scalar control distribution variance.
 * @param meanA Scalar control mean.
 * @param nA Control sample size.
 * @param varB Scalar treatment distribution variance.
 * @param meanB Scalar treatment distribution mean.
 * @param nB Treatment sample size.
 * @param relative boolean indicator for relative effects.
 * @returns variance.
 */
export function frequentistVariance(
  varA: number,
  meanA: number,
  nA: number,
  varB: number,
  meanB: number,
  nB: number,
  relative: boolean
): number {
  if (relative) {
    return (
      varB / (Math.pow(meanA, 2) * nB) +
      (varA * Math.pow(meanB, 2)) / (Math.pow(meanA, 4) * nA)
    );
  } else {
    return varB / nB + varA / nA;
  }
}

function getMetricMean(metric: MetricParams): number {
  return metric.type === "mean" ? metric.mean : metric.conversionRate;
}

type PriorParams = {
  proper: boolean;
  priorLiftMean: number;
  priorLiftStandardDeviation: number;
};

function getMetricPriorParams(params: MetricParams): PriorParams {
  if (params.overrideMetricLevelSettings)
    return {
      proper: params.overrideProper,
      priorLiftMean: params.overridePriorLiftMean,
      priorLiftStandardDeviation: params.overridePriorLiftStandardDeviation,
    };

  return {
    proper: params.metricProper,
    priorLiftMean: params.metricPriorLiftMean,
    priorLiftStandardDeviation: params.metricPriorLiftStandardDeviation,
  };
}

function getMetricVariance(metric: MetricParams): number {
  return metric.type === "mean"
    ? Math.pow(metric.standardDeviation, 2)
    : metric.conversionRate * (1 - metric.conversionRate);
}

export function powerStandardError(
  metric: MetricParams,
  nPerVariation: number,
  relative: boolean
): number {
  const metricMean = getMetricMean(metric);
  const metricVariance = getMetricVariance(metric);
  return Math.sqrt(
    frequentistVariance(
      metricVariance,
      metricMean,
      nPerVariation,
      metricVariance,
      metricMean * (1 + metric.effectSize),
      nPerVariation,
      relative
    )
  );
}

export function sequentialRho(
  alpha: number,
  sequentialTuningParameter: number
): number {
  return Math.sqrt(
    (-2 * Math.log(alpha) + Math.log(-2 * Math.log(alpha) + 1)) /
      sequentialTuningParameter
  );
}

export function sequentialDiscriminant(
  n: number,
  rho: number,
  alpha: number
): number {
  return (
    (2 *
      (n * Math.pow(rho, 2) + 1) *
      Math.log(Math.sqrt(n * Math.pow(rho, 2) + 1) / alpha)) /
    Math.pow(n * rho, 2)
  );
}

export function sequentialPowerSequentialVariance(
  variance: number,
  n: number,
  alpha: number,
  sequentialTuningParameter: number
): number {
  const standardErrorSampleMean = Math.sqrt(variance / n);
  const rho = sequentialRho(alpha, sequentialTuningParameter);
  const partUnderRadical = sequentialDiscriminant(n, rho, alpha);
  const zSequential = Math.sqrt(n) * Math.sqrt(partUnderRadical);
  const zStar = normal.quantile(1.0 - 0.5 * alpha, 0, 1);
  const standardErrorSequential =
    (standardErrorSampleMean * zSequential) / zStar;
  const vSequential = Math.pow(standardErrorSequential, 2);
  return n * vSequential;
}

export function sequentialPowerStandardError(
  metric: MetricParams,
  n: number,
  nVariations: number,
  alpha: number,
  sequentialTuningParameter: number,
  relative: boolean
): number {
  const metricMean = getMetricMean(metric);
  const metricVariance = getMetricVariance(metric);
  const v_rel = frequentistVariance(
    metricVariance,
    metricMean,
    n / nVariations,
    metricVariance,
    metricMean * (1.0 + metric.effectSize),
    n / nVariations,
    relative
  );
  return Math.sqrt(
    sequentialPowerSequentialVariance(
      v_rel,
      (2 * n) / nVariations,
      alpha,
      sequentialTuningParameter
    )
  );
}

function getSequentialTuningParameter(
  sequentialTesting: false | number
): number {
  let sequentialTuningParameter = 0.0;
  if (sequentialTesting !== false) {
    sequentialTuningParameter = sequentialTesting;
  }
  return sequentialTuningParameter;
}

/**
 * Performs power calculation
 *
 * @param effectSize Scalar lift (relative to the scalar mean of the distribution, expressed as percentage).
 * @param mean Scalar mean of the distribution.
 * @param variance Scalar variance of the distribution.
 * @param n Scalar sample size.
 * @param nVariations Scalar number of variations.
 * @param alpha false positive rate (default: 0.05).
 * @param twoTailed Binary indicator if the test is 1 or 2-tailed (default: true).
 * @returns Estimated power.
 */
export function powerEstFrequentist(
  metric: MetricParams,
  n: number,
  nVariations: number,
  alpha: number = 0.05,
  twoTailed: boolean = true,
  sequentialTesting: false | number
): number {
  const zStar = twoTailed
    ? normal.quantile(1.0 - 0.5 * alpha, 0, 1)
    : normal.quantile(1.0 - alpha, 0, 1);

  let standardError = 0;
  const sequentialTuningParameter = getSequentialTuningParameter(
    sequentialTesting
  );
  if (sequentialTuningParameter > 0) {
    standardError = sequentialPowerStandardError(
      metric,
      n,
      nVariations,
      alpha,
      sequentialTuningParameter,
      true
    );
  } else {
    standardError = powerStandardError(metric, n / nVariations, true);
  }
  const standardizedEffectSize = metric.effectSize / standardError;
  const upperCutpoint = zStar - standardizedEffectSize;
  let power = 1 - normal.cdf(upperCutpoint, 0, 1);
  if (twoTailed) {
    const lowerCutpoint = -zStar - standardizedEffectSize;
    power += normal.cdf(lowerCutpoint, 0, 1);
  }
  return power;
}

/**
 * Calculates minimum detectable effect
 *
 * @param power desired power.
 * @param mean Scalar mean of the distribution.
 * @param variance Scalar variance of the distribution.
 * @param n Scalar sample size.
 * @param nVariations Scalar number of variations.
 * @param alpha false positive rate (default: 0.05).
 * @returns object of class MDEResults, containing type and either mde or description.
 */
export function findMdeFrequentist(
  metric: MetricParams,
  power: number,
  n: number,
  nVariations: number,
  alpha: number = 0.05,
  sequentialTesting: false | number
): MDEResults {
  // Error handling:
  if (power <= alpha) {
    const mdeResults: MDEResults = {
      type: "error",
      description: "power must be greater than alpha.",
    };
    return mdeResults;
  }
  const nA = n / nVariations;
  const z =
    normal.quantile(1.0 - 0.5 * alpha, 0, 1) -
    normal.quantile(1.0 - power, 0, 1);
  const m = getMetricMean(metric);
  let v = getMetricVariance(metric);
  const sequentialTuningParameter = getSequentialTuningParameter(
    sequentialTesting
  );
  if (sequentialTuningParameter > 0) {
    v = sequentialPowerSequentialVariance(
      getMetricVariance(metric),
      2 * nA,
      alpha,
      sequentialTuningParameter
    );
  }
  //ensure the term under the radical is non-negative and that a positive solution exists.
  if (nA <= (v * z ** 2) / m ** 2) {
    const mdeResults: MDEResults = {
      type: "error",
      description:
        "need to increase number of users or reduce number of variations.",
    };
    return mdeResults;
  }
  const sigma2 = v / nA;
  const a_star = 1 - (z ** 2 * sigma2) / m ** 2;
  const b_star = -2 * m;
  const c_star = m ** 2 - z ** 2 * sigma2;
  const disc = b_star ** 2 - 4 * a_star * c_star;
  const sol_1 = (-b_star + Math.sqrt(disc)) / (2 * a_star);
  //const sol_2 = (-b_star - Math.sqrt(disc)) / (2 * a_star);
  const mdeResults: MDEResults = {
    type: "success",
    mde: (sol_1 - m) / m,
  };
  return mdeResults;
}

export function powerMetricWeeks(
  powerSettings: PowerCalculationParams
): PowerCalculationResults {
  const sampleSizeAndRuntimeNumeric: number[] = []; //for each metric, the first week they achieve 80% power.
  const mySampleSizeAndRuntime: {
    [id: string]: SampleSizeAndRuntime | undefined;
  } = {};

  const metricThresholds: Record<string, number> = {};
  const weeks: Week[] = [...Array(powerSettings.nWeeks).keys()].map((idx) => ({
    users: (idx + 1) * powerSettings.usersPerWeek,
    metrics: {},
  }));

  Object.entries(powerSettings.metrics).forEach(([metricKey, thisMetric]) => {
    let thisMDENumeric = NaN;
    let thisSampleSizeAndRuntimeNumeric = 999;
    let lookingForSampleSizeAndRunTime = true;
    for (let j = 0; j < powerSettings.nWeeks; j++) {
      const n = powerSettings.usersPerWeek * (j + 1);
      /*initialize block-scoped variables*/
      let thisPower = 0.0;
      let thisMde: MDEResults = {
        type: "success",
        mde: -999,
      };
      if (powerSettings.statsEngineSettings.type === "frequentist") {
        thisPower = powerEstFrequentist(
          thisMetric,
          n,
          powerSettings.nVariations,
          powerSettings.alpha,
          true,
          powerSettings.statsEngineSettings.sequentialTesting
        );
        thisMde = findMdeFrequentist(
          thisMetric,
          0.8,
          n,
          powerSettings.nVariations,
          powerSettings.alpha,
          powerSettings.statsEngineSettings.sequentialTesting
        );
      } else {
        thisPower = powerEstBayesian(
          thisMetric,
          powerSettings.alpha,
          n / powerSettings.nVariations,
          true
        );
        thisMde = findMdeBayesian(
          thisMetric,
          powerSettings.alpha,
          0.8,
          n / powerSettings.nVariations,
          true
        );
      }
      if (
        Math.round(thisPower * 100) / 100 >= 0.8 &&
        lookingForSampleSizeAndRunTime
      ) {
        lookingForSampleSizeAndRunTime = false;
        thisSampleSizeAndRuntimeNumeric = j + 1;
      }
      if (thisMde.type === "success") {
        thisMDENumeric = thisMde.mde;
      }
      if (
        powerSettings.targetPower < thisPower &&
        metricThresholds[metricKey] === undefined
      )
        metricThresholds[metricKey] = j;
      weeks[j].metrics[metricKey] = {
        effectSize: thisMDENumeric,
        power: thisPower,
        isThreshold: metricThresholds[metricKey] === j,
      };
    }
    sampleSizeAndRuntimeNumeric.push(thisSampleSizeAndRuntimeNumeric);
    const thisSampleSizeAndRuntime =
      thisSampleSizeAndRuntimeNumeric !== 999
        ? {
            weeks: thisSampleSizeAndRuntimeNumeric,
            users: powerSettings.usersPerWeek * thisSampleSizeAndRuntimeNumeric,
          }
        : undefined;
    mySampleSizeAndRuntime[metricKey] = thisSampleSizeAndRuntime;
  });
  const duration = Math.max(...sampleSizeAndRuntimeNumeric);

  const results: PowerCalculationResults = {
    sampleSizeAndRuntime: mySampleSizeAndRuntime,
    type: "success",
    weeks,
    ...(duration !== 999 ? { weekThreshold: duration } : {}),
  };
  return results;
}

/*******************/
export function calculatePriorMean(
  priorMeanRel: number,
  mean: number,
  relative: boolean
): number {
  return relative ? priorMeanRel : priorMeanRel * Math.abs(mean);
}

export function calculatePriorVariance(
  priorVarianceRel: number,
  mean: number,
  relative: boolean
): number {
  return relative ? priorVarianceRel : priorVarianceRel * Math.pow(mean, 2);
}

function calculatePriorMeanSpecified(
  metric: MetricParams,
  relative: boolean
): number {
  const metricMean = getMetricMean(metric);
  return calculatePriorMean(
    getMetricPriorParams(metric).priorLiftMean,
    metricMean,
    relative
  );
}

function calculatePriorVarianceSpecified(
  metric: MetricParams,
  relative: boolean
): number {
  const metricMean = getMetricMean(metric);
  return calculatePriorVariance(
    Math.pow(getMetricPriorParams(metric).priorLiftStandardDeviation, 2),
    metricMean,
    relative
  );
}

function calculatePriorMeanDGP(
  metric: MetricParams,
  relative: boolean
): number {
  const metricMean = getMetricMean(metric);
  return calculatePriorMean(metric.effectSize, metricMean, relative);
}

function calculatePriorVarianceDGP(
  metric: MetricParams,
  relative: boolean
): number {
  const metricMean = getMetricMean(metric);
  /*priorStandardDeviationDGP is 0 because we assume true fixed effect size*/
  const priorStandardDeviationDGP = 0;
  return calculatePriorVariance(
    Math.pow(priorStandardDeviationDGP, 2),
    metricMean,
    relative
  );
}

// Function to estimate variance of tau hat conditional on tau
function estimateTauHatVariance(
  metric: MetricParams,
  nPerVariation: number,
  relative: boolean
): number {
  const s = powerStandardError(metric, nPerVariation, relative);
  return Math.pow(s, 2);
}

// Function to calculate marginal variance of tau hat
function getMarginalVarianceTauHat(
  metric: MetricParams,
  nPerVariation: number,
  relative: boolean
): number {
  const priorVarianceDGP = calculatePriorVarianceDGP(metric, relative);
  const tauHatVariance = estimateTauHatVariance(
    metric,
    nPerVariation,
    relative
  );
  return tauHatVariance + priorVarianceDGP;
}

// Function to calculate posterior precision
function getPosteriorPrecision(
  metric: MetricParams,
  nPerVariation: number,
  relative: boolean
): number {
  const priorVarianceSpecified = calculatePriorVarianceSpecified(
    metric,
    relative
  );
  const tauHatVariance = estimateTauHatVariance(
    metric,
    nPerVariation,
    relative
  );
  const properInt = getMetricPriorParams(metric).proper ? 1 : 0;
  return 1 / tauHatVariance + properInt / priorVarianceSpecified;
}

export function getCutpoint(
  metric: MetricParams,
  alpha: number,
  nPerVariation: number,
  relative: boolean,
  upper: boolean
): number {
  const priorMeanSpecified = calculatePriorMeanSpecified(metric, relative);
  const priorVarianceSpecified = calculatePriorVarianceSpecified(
    metric,
    relative
  );
  const priorMeanDGP = calculatePriorMeanDGP(metric, relative);
  const tauHatVariance = estimateTauHatVariance(
    metric,
    nPerVariation,
    relative
  );
  const posteriorPrecision = getPosteriorPrecision(
    metric,
    nPerVariation,
    relative
  );
  const marginalVarianceTauHat = getMarginalVarianceTauHat(
    metric,
    nPerVariation,
    relative
  );
  const zStar = normal.quantile(1.0 - 0.5 * alpha, 0, 1);
  const upperSign = upper ? 1 : -1;
  const properInt = getMetricPriorParams(metric).proper ? 1 : 0;

  const numerator =
    upperSign * tauHatVariance * Math.sqrt(posteriorPrecision) * zStar -
    (properInt * (tauHatVariance * priorMeanSpecified)) /
      priorVarianceSpecified -
    priorMeanDGP;
  const denominator = Math.sqrt(marginalVarianceTauHat);
  return numerator / denominator;
}

/**
 * Performs power calculation
 *
 * @param metric an object of class MetricParams that has info about prior mean and sd, metric mean and sd, and effect size.
 * @param alpha false positive rate (default: 0.05).
 * @param nPerVariation sample size per variation.
 * @param relative boolean indicator if relative inference is desired.
 * @returns Estimated power.
 */
export function powerEstBayesian(
  metric: MetricParams,
  alpha: number,
  nPerVariation: number,
  relative: boolean
): number {
  const upperCutpoint = getCutpoint(
    metric,
    alpha,
    nPerVariation,
    relative,
    true
  );
  const lowerCutpoint = getCutpoint(
    metric,
    alpha,
    nPerVariation,
    relative,
    false
  );
  const powerPos = 1.0 - normal.cdf(upperCutpoint, 0, 1);
  const powerNeg = normal.cdf(lowerCutpoint, 0, 1);
  return powerPos + powerNeg;
}

/**
 * Performs mde calc
 * @param metric an object of class MetricParams that has info about prior mean and sd, metric mean and sd, and effect size.
 * @param alpha false positive rate (default: 0.05).
 * @param nPerVariation sample size per variation.
 * @param relative boolean indicator if relative inference is desired.
 * @param stepSize step size used in initial grid search.
 * @returns object of class MDEResults, containing type and either mde or description.
 */
function sweepGridFine(
  metric: MetricParams,
  alpha: number,
  power: number,
  nPerVariation: number,
  relative: boolean,
  stepSize: number
): MDEResults {
  const effectSize = metric.effectSize;
  const stepSizeFiner = stepSize / 100;
  const lowerBound = effectSize - stepSize;
  for (
    let effectSizeFiner = lowerBound;
    effectSizeFiner < effectSize;
    effectSizeFiner += stepSizeFiner
  ) {
    metric.effectSize = effectSizeFiner;
    const p = powerEstBayesian(metric, alpha, nPerVariation, relative);
    if (p >= power) {
      const mdeResults: MDEResults = {
        type: "success",
        mde: effectSizeFiner,
      };
      return mdeResults;
    }
  }
  const mdeResults: MDEResults = {
    type: "error",
    description: "MDE achieving power = 0.8 does not exist in this range. ",
  };
  return mdeResults;
}

/**
 * Performs mde calc
 * @param metric an object of class MetricParams that has info about prior mean and sd, metric mean and sd, and effect size.
 * @param alpha false positive rate (default: 0.05).
 * @param nPerVariation sample size per variation.
 * @param relative boolean indicator if relative inference is desired.
 * @returns object of class MDEResults, containing type and either mde or description.
 */
export function findMdeBayesian(
  metric: MetricParams,
  alpha: number,
  power: number,
  nPerVariation: number,
  relative: boolean
): MDEResults {
  /*fixed effect size, so prior variance of data generating process is 0*/
  let effectSize = 0;
  const dummyMetric = { ...metric, effectSize: effectSize };
  dummyMetric.effectSize = effectSize;
  let currentPower = powerEstBayesian(
    dummyMetric,
    alpha,
    nPerVariation,
    relative
  );
  /*case where 0 effect size results in at least 80% power*/
  if (currentPower >= power) {
    const mdeResults: MDEResults = {
      type: "success",
      mde: effectSize,
    };
    return mdeResults;
  }
  const stepSizeCoarse = 1e-3;
  const maxError = normal.pdf(0, 0, 1) * stepSizeCoarse;
  /*using integer of 5000 for stability in loop;
  combined with stepsize of 1e-3, max effectSize is 500%*/
  const numIters = 5000;
  for (let i = 0; i < numIters; i++) {
    effectSize = stepSizeCoarse * i;
    dummyMetric.effectSize = effectSize;
    currentPower = powerEstBayesian(
      dummyMetric,
      alpha,
      nPerVariation,
      relative
    );
    if (currentPower >= power - maxError) {
      const currentPowerFine = sweepGridFine(
        dummyMetric,
        alpha,
        power,
        nPerVariation,
        relative,
        stepSizeCoarse
      );
      if (currentPowerFine.type === "success") {
        return currentPowerFine;
      }
    }
  }
  /*case where mde is greater than 500% or doesn't exist*/
  const mdeResults: MDEResults = {
    type: "error",
    description: "MDE achieving power = 0.8 does not exist. ",
  };
  return mdeResults;
}

/*******************************************
MidExperimentPower calculations below here
********************************************/
/*used for calculating power at the end of the experiment*/
function finalPosteriorVariance(
  sigma2Posterior: number,
  sigmahat2Delta: number,
  scalingFactor: number
): number {
  const precPrior = 1 / sigma2Posterior;
  const precData = 1 / (sigmahat2Delta / scalingFactor);
  const prec = precPrior + precData;
  return 1 / prec;
}

function sequentialIntervalHalfwidth(
  s2: number,
  n: number,
  sequentialTuningParameter: number,
  alpha: number
): number {
  /**
   * Calculates the halfwidth of a sequential confidence interval.
   *
   * @param s2 The "variance" of the data.  Not really the variance, as it is the sample size times the variance of the effect estimate.
   * @param n The total sample size.
   * @param sequentialTuningParameter The tuning parameter for the sequential test.
   * @param alpha The significance level.
   * @returns The halfwidth of the sequential interval.
   */
  const rho = sequentialRho(alpha, sequentialTuningParameter);
  const disc = sequentialDiscriminant(n, rho, alpha);
  return Math.sqrt(s2) * Math.sqrt(disc);
}

/*calculate mid-experiment power for a single (metric, variation)*/
function calculateMidExperimentPowerSingle(
  params: MidExperimentPowerSingleMetricParams,
  metric: number,
  variation: number
): MetricVariationPowerResult {
  if (params.response == undefined) {
    return {
      metric: metric,
      variation: variation,
      calculationSucceeded: false,
      errorMessage: "Missing (metric, variation) power response from gbstats.",
    };
  }
  const response = params.response[0];
  if (response?.powerError) {
    return {
      metric: metric,
      variation: variation,
      calculationSucceeded: false,
      errorMessage: response.powerError,
    };
  }
  if (params.newDailyUsers == 0) {
    return {
      metric: metric,
      variation: variation,
      calculationSucceeded: false,
      errorMessage: "newDailyUsers is 0.",
    };
  }
  if (params.firstPeriodSampleSize == 0) {
    return {
      metric: metric,
      variation: variation,
      calculationSucceeded: false,
      errorMessage: "number of users currently in experiment is 0.",
    };
  }
  const lowPowerThreshold = 0.1;
  const numTests = (params.numVariations - 1) * params.numGoalMetrics;
  const firstPeriodPairwiseSampleSize = response.firstPeriodPairwiseSampleSize;
  const secondPeriodSampleSize = params.daysRemaining * params.newDailyUsers;
  const scalingFactor =
    (secondPeriodSampleSize + params.firstPeriodSampleSize) /
    params.firstPeriodSampleSize;
  let halfwidth: number;
  if (response.sigmahat2Delta == undefined) {
    return {
      metric: metric,
      variation: variation,
      calculationSucceeded: false,
      errorMessage: "Missing sigmahat2Delta.",
    };
  } else if (response.sigma2Posterior == undefined) {
    return {
      metric: metric,
      variation: variation,
      calculationSucceeded: false,
      errorMessage: "Missing sigma2Posterior.",
    };
  } else if (response.deltaPosterior == undefined) {
    return {
      metric: metric,
      variation: variation,
      calculationSucceeded: false,
      errorMessage: "Missing deltaPosterior.",
    };
  } else if (response.newDailyUsers == undefined) {
    return {
      metric: metric,
      variation: variation,
      calculationSucceeded: false,
      errorMessage: "Missing newDailyUsers.",
    };
  } else if (response.newDailyUsers == 0) {
    return {
      metric: metric,
      variation: variation,
      calculationSucceeded: false,
      errorMessage: "newDailyUsers is 0.",
    };
  } else if (response.additionalUsers == undefined) {
    return {
      metric: metric,
      variation: variation,
      calculationSucceeded: false,
      errorMessage:
        "Missing powerAdditionalUsers (currently used only for testing).",
    };
  } else if (response.minPercentChange == undefined) {
    return {
      metric: metric,
      variation: variation,
      calculationSucceeded: false,
      errorMessage: "Missing minPercentChange.",
    };
  } else {
    const sigmahat2Delta = response.sigmahat2Delta;
    const sigma2Posterior = response.sigma2Posterior;
    const deltaPosterior = response.deltaPosterior;
    const mPrime = 2 * response.minPercentChange;
    const vPrime = sigmahat2Delta;
    if (params.sequential) {
      const s2 = sigmahat2Delta * firstPeriodPairwiseSampleSize;
      const nTotal = firstPeriodPairwiseSampleSize * (1 + scalingFactor);
      halfwidth = sequentialIntervalHalfwidth(
        s2,
        nTotal,
        params.sequentialTuningParameter,
        params.alpha / numTests
      );
    } else {
      const zStar = normal.quantile(
        1.0 - (0.5 * params.alpha) / numTests,
        0,
        1
      );
      const v = finalPosteriorVariance(
        sigma2Posterior,
        sigmahat2Delta,
        scalingFactor
      );
      const s = Math.sqrt(v);
      halfwidth = zStar * s;
    }
    const marginalVar = sigma2Posterior + sigmahat2Delta / scalingFactor;
    const num1 = (halfwidth * marginalVar) / sigma2Posterior;
    const num2 =
      ((sigmahat2Delta / scalingFactor) * deltaPosterior) / sigma2Posterior;
    const num3 = mPrime;
    const den = Math.sqrt(vPrime);
    const numPos = num1 - num2 - num3;
    const numNeg = -num1 - num2 - num3;
    const powerPos = 1 - normal.cdf(numPos / den, 0, 1);
    const powerNeg = normal.cdf(numNeg / den, 0, 1);
    const totalPower = powerPos + powerNeg;
    const additionalUsers = Math.ceil(
      (response.scalingFactor - 1) * params.firstPeriodSampleSize
    );
    const powerResults: MetricVariationPowerResult = {
      newDailyUsers: response.newDailyUsers,
      metric: metric,
      variation: variation,
      effectSize: mPrime,
      power: totalPower,
      additionalDays: Math.ceil(additionalUsers / response.newDailyUsers),
      calculationSucceeded: true,
      lowPowerWarning: totalPower < lowPowerThreshold,
      errorMessage: "",
    };
    return powerResults;
  }
}

export function calculateMidExperimentPower(
  powerSettings: MidExperimentPowerParams
): MidExperimentPowerCalculationResult {
  const newDailyUsers = powerSettings.newDailyUsers;
  const numGoalMetrics = powerSettings.numGoalMetrics;
  const numVariations = powerSettings.numVariations;
  const daysRemaining = powerSettings.daysRemaining;
  const sequential = powerSettings.sequential;
  const alpha = powerSettings.alpha;
  const sequentialTuningParameter = powerSettings.sequentialTuningParameter;
  const powerResponses = powerSettings.response;
  const numTests = (numVariations - 1) * numGoalMetrics;
  const variationWeights = powerSettings.variationWeights;
  const power = new Array(numTests).fill(0);
  const additionalDays = new Array(numTests).fill(0);
  const maxPowerByMetric = new Array(numGoalMetrics).fill(0);
  const minDaysByMetric = new Array(numGoalMetrics).fill(0);
  const minUsersByMetric = new Array(numGoalMetrics).fill(0);
  const lowPowerThreshold = 0.1;
  const metricVariationPowerArray: MetricVariationPowerResult[] = [];
  let calculateAdditionalUsers = true;
  for (let metric = 0; metric < numGoalMetrics; metric++) {
    let thisMaxPower = 0.0;
    let thisMinDays = 0;
    const thisMinUsers = 0;
    for (let variation = 0; variation < numVariations - 1; variation++) {
      const powerIndex = metric * (numVariations - 1) + variation;
      const thisProportionOfUsers =
        variationWeights[0] + variationWeights[variation + 1];
      const thisNewDailyUsers = newDailyUsers * thisProportionOfUsers;
      const thisResponse = powerResponses[powerIndex];
      if (thisResponse.powerError) {
        calculateAdditionalUsers = false;
        metricVariationPowerArray.push({
          metric: metric,
          variation: variation,
          calculationSucceeded: false,
          effectSize: powerResponses[powerIndex].minPercentChange * 2,
          errorMessage: thisResponse.powerError,
        });
      } else {
        const powerParams: MidExperimentPowerSingleMetricParams = {
          newDailyUsers: thisNewDailyUsers,
          firstPeriodSampleSize: powerSettings.firstPeriodSampleSize,
          daysRemaining: daysRemaining,
          sequential,
          alpha,
          sequentialTuningParameter,
          numVariations,
          numGoalMetrics,
          response: [thisResponse],
        };
        const resultsSingleMetric = calculateMidExperimentPowerSingle(
          powerParams,
          metric,
          variation
        );
        metricVariationPowerArray.push(resultsSingleMetric);
        if (
          resultsSingleMetric.calculationSucceeded &&
          resultsSingleMetric.power &&
          resultsSingleMetric.additionalDays
        ) {
          const thisPower = resultsSingleMetric.power;
          power[powerIndex] = thisPower;
          additionalDays[powerIndex] = resultsSingleMetric.additionalDays;
          if (thisPower > thisMaxPower) {
            thisMaxPower = thisPower;
          }
          if (resultsSingleMetric.additionalDays > thisMinDays) {
            thisMinDays = resultsSingleMetric.additionalDays;
          }
        } else {
          calculateAdditionalUsers = false;
        }
        maxPowerByMetric[metric] = thisMaxPower;
        minDaysByMetric[metric] = thisMinDays;
        minUsersByMetric[metric] = thisMinUsers;
      }
    }
  }
  const minPower = Math.min(...maxPowerByMetric);
  if (calculateAdditionalUsers) {
    return {
      type: "success",
      power: minPower,
      additionalDays: Math.max(...minDaysByMetric),
      additionalUsers: Math.max(...minUsersByMetric),
      lowPowerWarning: minPower < lowPowerThreshold,
      metricVariationPowerResults: metricVariationPowerArray,
    };
  } else {
    return {
      type: "error",
      lowPowerWarning: minPower < lowPowerThreshold,
      metricVariationPowerResults: metricVariationPowerArray,
    };
  }
}

export function getAverageExposureOverLastNDays(
  traffic: ExperimentSnapshotTraffic,
  nDays: number,
  baseDate = new Date()
) {
  const lastNDates = eachDayOfInterval({
    start: subDays(baseDate, nDays),
    end: subDays(baseDate, 1),
  }).map((date) => formatISO(date, { representation: "date" }));

  const totalExposure = traffic.dimension?.dim_exposure_date
    .filter((dim) => lastNDates.includes(dim.name))
    .map((dim) => dim.variationUnits.reduce((acc, num) => acc + num, 0))
    .reduce((acc, num) => acc + num, 0);

  return Math.floor(totalExposure / nDays);
}
