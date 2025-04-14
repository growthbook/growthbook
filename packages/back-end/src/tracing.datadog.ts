import "./init/aliases";
import tracer from "dd-trace";
import { Attributes, setMetrics } from "./util/metrics";

tracer.init({
  logInjection: true,
});

const COLLECTION_INTERVAL_SECONDS = 15;

class Counter {
  name: string;
  value: number;
  attributes?: Attributes;

  constructor(name: string) {
    this.name = name;
    this.value = 0;
    setInterval(() => this.collect(), COLLECTION_INTERVAL_SECONDS * 1000);
  }

  add(v: number, attributes?: Attributes) {
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
  attributes?: Attributes;

  constructor(name: string) {
    this.name = name;
    this.value = 0;
    this.count = 0;
    setInterval(() => this.collect(), COLLECTION_INTERVAL_SECONDS * 1000);
  }

  record(v: number, attributes?: Attributes) {
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
