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

export interface PowerCalculationParams {
  metrics: { [id: string]: MetricParams };
  nVariations: number;
  usersPerDay: number;
  targetPower: number;
  statsEngine: {
    type: "frequentist";
    sequentialTesting: false | number;
  };
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
  },
  effectSize: { title: "Effect Size", isPercent: true, canBeNegative: false },
  mean: { title: "Mean", isPercent: false, canBeNegative: true },
  standardDeviation: {
    title: "Standard Deviation",
    isPercent: false,
    canBeNegative: false,
  },
  conversionRate: {
    title: "Conversion Rate",
    isPercent: true,
    canBeNegative: false,
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

interface SampleSizeAndRuntime {
  name: string;
  effectSize: number;
  users: number;
  days: number;
  type: "mean" | "binomial";
}

interface Week {
  users: number;
  metrics: {
    [id: string]: {
      name: string;
      type: "mean" | "binomial";
      effectSize: number;
      power: number;
    };
  };
}

export type PowerCalculationResults = {
  duration: number;
  power: number;
  sampleSizeAndRuntime: {
    [id: string]: SampleSizeAndRuntime;
  };
  weeks: Week[];
  minimumDetectableEffectOverTime: {
    weeks?: number;
    powerThreshold: number;
  };
  powerOverTime: {
    weeks?: number;
    powerThreshold: number;
  };
};
