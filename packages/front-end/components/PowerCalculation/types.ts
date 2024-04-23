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
  usersPerDay: number;
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

export const config = {
  usersPerDay: {
    title: "Users Per Day",
    isPercent: false,
    canBeNegative: false,
    defaultValue: undefined,
  },
  effectSize: {
    title: "Effect Size",
    isPercent: false,
    canBeNegative: false,
    defaultValue: 0.5,
  },
  mean: {
    title: "Mean",
    isPercent: false,
    canBeNegative: true,
    defaultValue: undefined,
  },
  standardDeviation: {
    title: "Standard Deviation",
    isPercent: false,
    canBeNegative: false,
    defaultValue: undefined,
  },
  conversionRate: {
    title: "Conversion Rate",
    isPercent: true,
    canBeNegative: false,
    defaultValue: undefined,
  },
} as const;

const validEntry = (name: keyof typeof config, v: number | undefined) => {
  if (v === undefined) return false;
  if (isNaN(v)) return false;

  if (config[name].isPercent) if (v < 0 || 1 < v) return false;

  if (config[name].canBeNegative) return true;

  return 0 <= v;
};

export const isValidPowerCalculationParams = (
  v: PartialPowerCalculationParams
): v is FullModalPowerCalculationParams =>
  validEntry("usersPerDay", v.usersPerDay) &&
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

export type PowerCalculationResults =
  | {
      type: "success";
      sampleSizeAndRuntime: {
        [id: string]: SampleSizeAndRuntime;
      };
      weeks: Week[];
      weekThreshold?: number;
    }
  | {
      type: "error";
      description: string;
    };
