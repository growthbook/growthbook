import { OrganizationSettings } from "@back-end/types/organization";

export interface MetricParamsBase {
  name: string;
  effectSize: number;
  priorLiftMean: number;
  priorLiftStandardDeviation: number;
  proper: boolean;
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

export type PartialPowerCalculationParams = Partial<
  Omit<FullModalPowerCalculationParams, "metrics">
> & {
  metrics: {
    [id: string]: Partial<Omit<MetricParams, "name">> & {
      name: string;
    };
  };
};

type Config = {
  title: string;
  tooltip?: string;
} & (
  | {
      type: "percent" | "number";
      minValue?: number;
      maxValue?: number;
      defaultSettingsValue?: (_: OrganizationSettings) => number | undefined;
      defaultValue?: number;
    }
  | {
      type: "boolean";
      defaultSettingsValue?: (_: OrganizationSettings) => boolean | undefined;
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
    type: "number",
  },
  standardDeviation: {
    title: "Standard Deviation",
    type: "number",
    minValue: 0,
  },
  conversionRate: {
    title: "Conversion Rate",
    type: "percent",
    minValue: 0,
    maxValue: 1,
  },
  priorLiftMean: {
    title: "Prior mean",
    type: "percent",
    tooltip: "Prior mean for the relative effect size.",
    defaultSettingsValue: (s) => s.metricDefaults?.priorSettings?.mean,
    defaultValue: 0,
  },
  priorLiftStandardDeviation: {
    title: "Prior standard deviation",
    type: "percent",
    tooltip: "Prior standard deviation for the relative effect size.",
    minValue: 0,
    defaultSettingsValue: (s) => s.metricDefaults?.priorSettings?.stddev,
    defaultValue: 1,
  },
  proper: {
    title: "Use proper prior",
    type: "boolean",
    defaultSettingsValue: (s) => s.metricDefaults?.priorSettings?.override,
    defaultValue: false,
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
    return ([
      "effectSize",
      ...(engineType === "bayesian"
        ? (["proper", "priorLiftMean", "priorLiftStandardDeviation"] as const)
        : []),
      ...(params.type === "binomial"
        ? (["conversionRate"] as const)
        : (["mean", "standardDeviation"] as const)),
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
