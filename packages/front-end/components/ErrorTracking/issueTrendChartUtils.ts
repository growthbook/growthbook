export type GraphPoint = { t: number; c: number };

export function getBucketStepMs(data: GraphPoint[], index: number): number {
  if (data.length > 1) {
    if (index < data.length - 1) {
      return Math.abs(data[index + 1].t - data[index].t);
    }
    return Math.abs(data[index].t - data[index - 1].t);
  }
  return 86_400_000;
}

export function getSeriesBucketStepMs(data: GraphPoint[]): number {
  if (data.length > 1) {
    const steps = data
      .slice(1)
      .map((point, index) => Math.abs(point.t - data[index].t))
      .filter((step) => step > 0);
    if (steps.length) {
      return Math.min(...steps);
    }
  }
  return 86_400_000;
}

export function getBucketRange(
  data: GraphPoint[],
  bucketStartMs: number,
): { fromMs: number; toMs: number } {
  const index = data.findIndex((point) => point.t === bucketStartMs);
  const stepMs =
    index >= 0 ? getBucketStepMs(data, index) : getSeriesBucketStepMs(data);
  return { fromMs: bucketStartMs, toMs: bucketStartMs + stepMs };
}

export function findBucketStartForTimestamp(
  data: GraphPoint[],
  timestampMs: number,
): number | null {
  for (let index = data.length - 1; index >= 0; index--) {
    const stepMs = getBucketStepMs(data, index);
    if (timestampMs >= data[index].t && timestampMs < data[index].t + stepMs) {
      return data[index].t;
    }
  }
  return null;
}
