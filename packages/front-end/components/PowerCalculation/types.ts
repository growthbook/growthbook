export type MetricParams =
  | {
      type: "mean";
      name: string;
      effect: number;
      mean: number;
      standardDeviation: number;
    }
  | {
      type: "binomial";
      name: string;
      effect: number;
      conversionRate: number;
    };

export interface PowerCalculationParams {
  metrics: { [id: string]: MetricParams };
  usersPerDay: number;
}

export type PartialPowerCalculationParams = Partial<
  Omit<PowerCalculationParams, "metrics">
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
): v is PowerCalculationParams =>
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
): PowerCalculationParams => {
  if (!isValidPowerCalculationParams(v)) throw "internal error";
  return v;
};

interface SampleSizeAndRuntime {
  name: string;
  effect: number;
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
      effect: number;
      power: number;
    };
  };
}

export type PowerCalculationResults = {
  variations: number;
  duration: number;
  power: number;
  sampleSizeAndRuntime: {
    [id: string]: SampleSizeAndRuntime;
  };
  weeks: Week[];
};
