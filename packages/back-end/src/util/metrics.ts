export type Attributes = Record<string, string | number>;

export type Counter = {
  increment: (attributes?: Attributes) => void;
  decrement: (attributes?: Attributes) => void;
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
    increment: () => undefined,
    decrement: () => undefined,
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
