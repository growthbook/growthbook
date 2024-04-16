interface MetricParams {
  name: string;
  effectSize: number;
  mean: number;
  standardDeviation: number;
}

export interface PowerCalculationParams {
  metrics: { [id: string]: MetricParams };
  effectSize: number;
  conversionRate: number;
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
  ["effectSize", "conversionRate", "usersPerDay"].every((k) =>
    validEntry(v[k])
  ) &&
  Object.keys(v.metrics).every((key) => {
    const params = v.metrics[key];
    if (!params) return false;
    return ["effectSize", "mean", "standardDeviation"].every((k) =>
      validEntry(params[k])
    );
  });

export const ensureAndReturnPowerCalculationParams = (
  v: PartialPowerCalculationParams
): PowerCalculationParams => {
  if (!isValidPowerCalculationParams(v)) throw "internal error";
  return v;
};

interface SampleSizeAndRuntime {
  effectSize: number;
  neededSample: number;
  type: "mean" | "proportion";
}

interface MinimumDetectableEffectOverTime {
  type: "mean" | "proportion";
  weeks: [
    {
      users: number;
      effect: number;
    }
  ];
}

interface PowerOverTime {
  type: "mean" | "proportion";
  weeks: [
    {
      users: number;
      power: number;
    }
  ];
}

export type PowerCalculationResults = {
  [name: string]: {
    sampleSizeAndRuntime: SampleSizeAndRuntime;
    minimumDetectableEffectOverTime: MinimumDetectableEffectOverTime;
    powerOverTime: PowerOverTime;
  };
};
