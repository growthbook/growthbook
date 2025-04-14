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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  add(v: number, attributes?: any) {
    this.value += v;
    this.attributes = attributes;
  }

  collect() {
    tracer.dogstatsd.gauge(this.name, this.value, this.attributes);
  }
}

class Histogram {
  name: string;
  value: number;
  count: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attributes?: any;

  constructor(name: string) {
    this.name = name;
    this.value = 0;
    this.count = 0;
    setInterval(this.collect, COLLECTION_INTERVAL);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  record(v: number, attributes?: any) {
    this.value += v;
    this.count++;
    this.attributes = attributes;
  }

  collect() {
    if (this.count)
      tracer.dogstatsd.gauge(
        this.name,
        this.value / this.count,
        this.attributes
      );
  }
}

setMetrics({
  getCounter: (name: string) => new Counter(name),
  getHistogram: (name: string) => new Histogram(name),
});
