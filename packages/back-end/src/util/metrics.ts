export type Attributes = Record<string, string | number>;

export type Counter = {
  add: (incr: number, attributes?: Attributes) => void;
};

export type Histogram = {
  record: (value: number, attributes?: Attributes) => void;
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
