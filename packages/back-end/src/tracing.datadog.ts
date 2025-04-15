import "./init/aliases";
import tracer from "dd-trace";
import { Attributes, setMetrics } from "./util/metrics";

tracer.init({
  logInjection: true,
});

class Counter {
  name: string;
  value: number;

  constructor(name: string) {
    this.name = name;
    this.value = 0;
  }

  add(v: number, attributes?: Attributes) {
    this.value += v;
    tracer.dogstatsd.gauge(this.name, this.value, attributes);
  }
}

class Histogram {
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
});
