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

const validEntry = (v: number | undefined) =>
  v !== undefined && !isNaN(v) && 0 < v;

export const isValidPowerCalculationParams = (
  v: PartialPowerCalculationParams
): v is FullModalPowerCalculationParams =>
  validEntry(v.usersPerDay) &&
  Object.keys(v.metrics).every((key) => {
    const params = v.metrics[key];
    if (!params) return false;
    return [
      "effect",
      ...(params.type === "binomial"
        ? ["conversionRate"]
        : ["mean", "standardDeviation"]),
    ].every((k) => validEntry(params[k]));
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
  minimumDetectableEffectOverTime?: {
    weeks: number;
    effectThreshold: number;
  };
  powerOverTime?: {
    weeks: number;
    powerThreshold: number;
  };
};
