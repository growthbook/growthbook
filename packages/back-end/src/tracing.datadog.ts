import "./init/aliases";
import tracer from "dd-trace";
import { setMetrics } from "./util/metrics";

tracer.init(); // initialized in a different file to avoid hoisting.

setMetrics({
  getCounter: (name: string) => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    add: (incr: number, attributes?: any) =>
      tracer.dogstatsd.increment(name, incr, attributes),
  }),
  getHistogram: (name: string) => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    record: (value: number, attributes?: any) =>
      tracer.dogstatsd.histogram(name, value, attributes),
  }),
});
