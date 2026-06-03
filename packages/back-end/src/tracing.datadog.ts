import "./init/aliases";
import ddTracer from "dd-trace";
import Tags from "dd-trace/ext/tags";
import {
  MetricAttributes,
  HistogramOptions,
  noopSpan,
  setMetrics,
  setTracer,
  Span,
  SpanAttributes,
  SpanAttributeValue,
} from "./util/metrics";

// Experiment-update traces are head-sampled in application code: the dedicated
// `experiment.update` root span (and its async query spans) is only created for
// a sampled refresh, so no backend sampling rule is needed for it here. Other
// traces — including the request spans that unsampled refreshes may still attach
// synchronous phase spans to — are governed by dd-trace's own sampling as before.
ddTracer.init({
  logInjection: true,
  runtimeMetrics: true,
});

type DatadogSpan = ReturnType<typeof ddTracer.startSpan>;

class Counter {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  increment(attributes?: MetricAttributes) {
    ddTracer.dogstatsd.increment(this.name, 1, attributes);
  }

  decrement(attributes?: MetricAttributes) {
    ddTracer.dogstatsd.decrement(this.name, 1, attributes);
  }
}

class Histogram {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  record(v: number, attributes?: MetricAttributes) {
    ddTracer.dogstatsd.histogram(this.name, v, attributes);
  }
}

class Gauge {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  record(v: number, attributes?: MetricAttributes) {
    ddTracer.dogstatsd.gauge(this.name, v, attributes);
  }
}

setMetrics({
  getCounter: (name: string) => new Counter(name),
  getHistogram: (name: string, opts?: HistogramOptions) => {
    // DogStatsD does not carry units in the wire protocol, so opts are ignored.
    void opts;
    return new Histogram(name);
  },
  getGauge: (name: string) => new Gauge(name),
});

const wrapSpan = (span: DatadogSpan): Span => {
  // Once a span has ended, ownership is final: ignore any further mutation so
  // an abandoned runner racing with the caller's error handling cannot re-tag,
  // re-status, or double-finish the span.
  let ended = false;
  let asyncCompletionClaimed = false;
  return {
    setAttribute: (key: string, value: SpanAttributeValue) => {
      if (ended) return;
      span.setTag(key, value);
    },
    setAttributes: (attrs: SpanAttributes) => {
      if (ended) return;
      Object.entries(attrs).forEach(([key, value]) => span.setTag(key, value));
    },
    recordException: (err: unknown) => {
      if (ended) return;
      span.setTag(Tags.ERROR, err instanceof Error ? err : String(err));
    },
    setStatus: (status: "ok" | "error", message?: string) => {
      if (ended) return;
      if (status === "error") {
        span.setTag(Tags.ERROR, message || true);
      }
    },
    end: () => {
      if (ended) return;
      ended = true;
      span.finish();
    },
    isEnded: () => ended,
    claimAsyncCompletion: () => {
      asyncCompletionClaimed = true;
    },
    isAsyncCompletionClaimed: () => asyncCompletionClaimed,
  };
};

setTracer({
  startActiveSpan: (name, attributes, fn, options) => {
    const parent = ddTracer.scope().active();

    // dd-trace only parents a span when childOf is passed explicitly, so for a
    // new root we omit childOf (starting its own trace) and instead link back
    // to the triggering span to preserve the causal hop.
    const span = ddTracer.startSpan(name, {
      ...(parent && !options?.newRoot ? { childOf: parent } : {}),
      tags: attributes,
    });
    if (options?.newRoot && parent) {
      span.addLinks([{ context: parent.context() }]);
    }
    return ddTracer.scope().activate(span, () => fn(wrapSpan(span)));
  },
  getActiveSpan: () => {
    const span = ddTracer.scope().active();
    return span ? wrapSpan(span) : noopSpan;
  },
  captureContext: () => ddTracer.scope().active(),
  withContext: (context, fn) => {
    if (!context) return fn();
    return ddTracer.scope().activate(context as DatadogSpan, fn);
  },
});
