import "./init/aliases";
import tracer from "dd-trace";
import { setMetrics } from "./util/metrics";

tracer.init({
  logInjection: true,
});

const COLLECTION_INTERVAL = 15;

class Counter {
  name: string;
  value: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attributes?: any;

  constructor(name: string) {
    this.name = name;
    this.value = 0;
    setInterval(this.collect, COLLECTION_INTERVAL);
  }

  add(v: number) {
    this.value += v;
  }

  collect() {
    tracer.dogstatsd.gauge(this.name, this.value, this.attributes);
  }
}

setMetrics({
  getCounter: (name: string) => new Counter(name),
  getHistogram: (name: string) => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    record: (value: number, attributes?: any) =>
      tracer.dogstatsd.histogram(name, value, attributes),
  }),
});
