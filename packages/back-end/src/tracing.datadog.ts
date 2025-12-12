import "./init/aliases";
import tracer from "dd-trace";
import { Attributes, setMetrics } from "./util/metrics";

tracer.init({
  logInjection: true,
  runtimeMetrics: true,
});

class Counter {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  increment(attributes?: Attributes) {
    tracer.dogstatsd.increment(this.name, 1, attributes);
  }

  decrement(attributes?: Attributes) {
    tracer.dogstatsd.decrement(this.name, 1, attributes);
  }
}

class Histogram {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  record(v: number, attributes?: Attributes) {
    tracer.dogstatsd.histogram(this.name, v, attributes);
  }
}

class Gauge {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  record(v: number, attributes?: Attributes) {
    tracer.dogstatsd.gauge(this.name, v, attributes);
  }
}

setMetrics({
  getCounter: (name: string) => new Counter(name),
  getHistogram: (name: string) => new Histogram(name),
  getGauge: (name: string) => new Gauge(name),
});
