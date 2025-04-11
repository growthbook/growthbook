export type Counter = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  add: (incr: number, attributes?: any) => void;
};

export type Histogram = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  record: (value: number, attributes?: any) => void;
};

type Metrics = {
  getCounter: (_: string) => Counter;
  getHistogram: (_: string) => Histogram;
};

export const metrics: Metrics = {
  getCounter: (_: string) => ({
    add: () => undefined,
  }),
  getHistogram: (_: string) => ({
    record: () => undefined,
  }),
};

export const setMetrics = (newMetrics: Metrics) => {
  (Object.keys(metrics) as (keyof Metrics)[]).forEach(
    <K extends keyof Metrics>(k: K) => (metrics[k] = newMetrics[k])
  );
};
