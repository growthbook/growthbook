export function getStandardErrorFromLargestSample(
  samples: {
    totalUnits: number;
    standardError: number;
  }[],
): number | null {
  const largestSample = samples.reduce<(typeof samples)[number] | null>(
    (largest, sample) => {
      if (sample.standardError <= 0) return largest;
      if (!largest || sample.totalUnits > largest.totalUnits) return sample;
      return largest;
    },
    null,
  );

  return largestSample?.standardError ?? null;
}

export function jamesSteinAdjustment(
  effects: number[],
  se: number,
  useMean: boolean = false,
) {
  const Ne = effects.length;
  const priorMean = useMean ? effects.reduce((a, b) => a + b, 0) / Ne : 0;
  const Z = effects.reduce((a, b) => a + Math.pow(b - priorMean, 2), 0);
  const adj = Math.max(Math.min(((Ne - 2) * Math.pow(se, 2)) / Z, 1), 0);
  const variance = 1 + 1 / Z;
  return { mean: priorMean, adjustment: adj, variance: variance };
}
