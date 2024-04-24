export type MetricParams =
  | {
      type: "mean";
      name: string;
      effectSize: number;
      mean: number;
      standardDeviation: number;
    }
  | {
      type: "binomial";
      name: string;
      effectSize: number;
      conversionRate: number;
    };

export interface StatsEngine {
  type: "frequentist";
  sequentialTesting: false | number;
}

export interface PowerCalculationParams {
  metrics: { [id: string]: MetricParams };
  nVariations: number;
  nWeeks: number;
  alpha: number;
  usersPerWeek: number;
  targetPower: number;
  statsEngine: StatsEngine;
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
    title: "Anticipated Effect Size",
    isPercent: true,
    minValue: 0,
    defaultValue: 1,
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
    maxValue: 100,
  },
});

const validEntry = (name: keyof typeof config, v: number | undefined) => {
  if (v === undefined) return false;
  if (isNaN(v)) return false;

  const { maxValue, minValue } = config[name];

  if (minValue !== undefined && v < minValue) return false;
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
  name: string;
  effectSize: number;
  users: number;
  weeks?: number;
  type: "mean" | "binomial";
}

export interface Week {
  users: number;
  metrics: {
    [id: string]: {
      name: string;
      type: "mean" | "binomial";
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
    [id: string]: SampleSizeAndRuntime;
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
