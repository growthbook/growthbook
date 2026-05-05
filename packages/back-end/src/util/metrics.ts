export type Attributes = Record<string, string | number>;

export type Counter = {
  increment: (attributes?: Attributes) => void;
  decrement: (attributes?: Attributes) => void;
};

export type Histogram = {
  record: (value: number, attributes?: Attributes) => void;
};

export type Gauge = {
  record: (value: number, attributes?: Attributes) => void;
};

type Metrics = {
  getCounter: (_: string) => Counter;
  getHistogram: (_: string) => Histogram;
  getGauge: (_: string) => Gauge;
};

export const metrics: Metrics = {
  getCounter: (_: string) => ({
    increment: () => undefined,
    decrement: () => undefined,
  }),
  getHistogram: (_: string) => ({
    record: () => undefined,
  }),
  getGauge: (_: string) => ({
    record: () => undefined,
  }),
};

export const setMetrics = (newMetrics: Metrics) => {
  (Object.keys(metrics) as (keyof Metrics)[]).forEach(
    <K extends keyof Metrics>(k: K) => (metrics[k] = newMetrics[k]),
  );
};
