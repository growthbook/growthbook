export type MetricParamsFrequentist =
  | {
      type: "mean";
      name: string;
      effectSize: number;
      metricMean: number;
      metricStandardDeviation: number;
    }
  | {
      type: "binomial";
      name: string;
      effectSize: number;
      conversionRate: number;
    };

export type MetricParamsBayesian =
  | {
      type: "mean";
      name: string;
      metricMean: number;
      metricStandardDeviation: number;
      effectSize: number;
      priorStandardDeviationDGP: number;
      priorLiftMean: number;
      priorLiftStandardDeviation: number;
      proper: boolean;
    }
  | {
      type: "binomial";
      name: string;
      conversionRate: number;
      effectSize: number;
      priorStandardDeviationDGP: number;
      priorLiftMean: number;
      priorLiftStandardDeviation: number;
      proper: boolean;
    };

/*export interface StatsEngineFrequentist {*/
export interface StatsEngineSettings {
  type: "frequentist" | "bayesian";
  sequentialTesting: false | number;
}
/*export interface StatsEngineBayesian {
  type: "bayesian";
  sequentialTesting: false;
}*/

export interface PowerCalculationParams {
  metrics: { [id: string]: MetricParamsFrequentist };
  nVariations: number;
  nWeeks: number;
  alpha: number;
  usersPerWeek: number;
  targetPower: number;
  statsEngineSettings: StatsEngineSettings;
}

export interface PowerCalculationParamsBayesian {
  metrics: { [id: string]: MetricParamsBayesian };
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
  isPercent: boolean;
  tooltip?: string;
  minValue?: number;
  maxValue?: number;
  defaultValue?: number;
};

const checkConfig = <T extends string>(config: { [id in T]: Config }) => config;

export const config = checkConfig({
  usersPerWeek: {
    title: "Users Per Day",
    isPercent: false,
    minValue: 0,
  },
  effectSize: {
    title: "Effect Size",
    isPercent: true,
    tooltip:
      "This is the relative effect size that you anticipate for your experiment. Setting this allows us to compute the number of weeks needed to reliably detect an effect of this size or larger.",
    minValue: 0,
    defaultValue: 0.01,
  },
  mean: {
    title: "Mean",
    isPercent: false,
  },
  standardDeviation: {
    title: "Standard Deviation",
    isPercent: false,
    minValue: 0,
  },
  conversionRate: {
    title: "Conversion Rate",
    isPercent: true,
    minValue: 0,
    maxValue: 1,
  },
});

const validEntry = (name: keyof typeof config, v: number | undefined) => {
  if (v === undefined) return false;
  if (isNaN(v)) return false;

  const { maxValue, minValue } = config[name];

  if (minValue !== undefined && v <= minValue) return false;
  if (maxValue !== undefined && maxValue < v) return false;

  return true;
};

export const isValidPowerCalculationParams = (
  v: PartialPowerCalculationParams
): v is FullModalPowerCalculationParams =>
  validEntry("usersPerWeek", v.usersPerWeek) &&
  Object.keys(v.metrics).every((key) => {
    const params = v.metrics[key];
    if (!params) return false;
    return ([
      "effectSize",
      ...(params.type === "binomial"
        ? (["conversionRate"] as const)
        : (["mean", "standardDeviation"] as const)),
    ] as const).every((k) => validEntry(k, params[k]));
  });

export const ensureAndReturnPowerCalculationParams = (
  v: PartialPowerCalculationParams
): FullModalPowerCalculationParams => {
  if (!isValidPowerCalculationParams(v)) throw "internal error";
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
