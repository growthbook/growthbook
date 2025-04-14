import "./init/aliases";
import tracer from "dd-trace";
import { setMetrics } from "./util/metrics";

tracer.init({
  logInjection: true,
});

setMetrics({
  getCounter: (name: string) => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    add: (incr: number, attributes?: any) =>
      tracer.dogstatsd.gauge(name, incr, attributes),
  }),
  getHistogram: (name: string) => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    record: (value: number, attributes?: any) =>
      tracer.dogstatsd.histogram(name, value, attributes),
  }),
});
