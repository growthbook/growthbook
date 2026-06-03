import {
  instrumentPhase,
  noopSpan,
  setTracer,
  Span,
  toLogAttrs,
  toMetricAttrs,
  shouldSampleExperimentUpdateTrace,
  SpanAttributes,
  TraceContext,
} from "back-end/src/util/metrics";

function makeRecordingTracer() {
  const spans: {
    name: string;
    parent: string | null;
    status?: "ok" | "error";
    ended: boolean;
  }[] = [];
  let activeSpan: Span = noopSpan;
  const makeSpan = (name: string): Span => {
    const record = {
      name,
      parent: activeSpan === noopSpan ? null : (spans.at(-1)?.name ?? null),
      status: undefined as "ok" | "error" | undefined,
      ended: false,
    };
    spans.push(record);
    let asyncCompletionClaimed = false;
    const span: Span = {
      setAttribute: () => undefined,
      setAttributes: () => undefined,
      recordException: () => undefined,
      setStatus: (status) => {
        record.status = status;
      },
      end: () => {
        record.ended = true;
      },
      isEnded: () => record.ended,
      claimAsyncCompletion: () => {
        asyncCompletionClaimed = true;
      },
      isAsyncCompletionClaimed: () => asyncCompletionClaimed,
    };
    return span;
  };
  const startActiveSpan = <T>(
    name: string,
    _attributes: SpanAttributes | undefined,
    fn: (span: Span) => T,
  ): T => {
    const previous = activeSpan;
    const span = makeSpan(name);
    activeSpan = span;
    const result = fn(span);
    if (result instanceof Promise) {
      return result.finally(() => {
        activeSpan = previous;
      }) as T;
    }
    activeSpan = previous;
    return result;
  };
  setTracer({
    startActiveSpan,
    getActiveSpan: () => activeSpan,
    captureContext: () => activeSpan,
    withContext: (context: TraceContext, fn) => {
      const previous = activeSpan;
      activeSpan = context as Span;
      try {
        return fn();
      } finally {
        activeSpan = previous;
      }
    },
  });
  // Run `fn` with a recording root span as the ambient active span, mirroring
  // how production establishes an active span via startActiveSpan/withContext.
  const withActiveRoot = <T>(fn: () => T): T => {
    const previous = activeSpan;
    activeSpan = makeSpan("root");
    try {
      return fn();
    } finally {
      activeSpan = previous;
    }
  };
  return { withActiveRoot, spans };
}

function makeNoopTracer() {
  setTracer({
    startActiveSpan: (_name, _attributes, fn) => fn(noopSpan),
    getActiveSpan: () => noopSpan,
    captureContext: () => null,
    withContext: (_context, fn) => fn(),
  });
}

describe("metrics utils", () => {
  describe("toMetricAttrs", () => {
    it("filters high-cardinality attributes and converts booleans", () => {
      expect(
        toMetricAttrs({
          "experiment.id": "exp_123",
          "snapshot.id": "snp_123",
          "org.id": "org_123",
          "query_runner.id": "runner_123",
          "query.id": "qry_123",
          "analysis.id": "analysis_123",
          "query.name": "Experiment query",
          "query_runner.error": "warehouse failed",
          "query_runner.kind": "ExperimentResultsQueryRunner",
          "update.mode": "incremental-full-refresh",
          "snapshot.type": "standard",
          "query.type": "experiment",
          "query.cached": true,
          "analyses.count": 2,
          "query.dependencies_count": 3,
        }),
      ).toEqual({
        "query_runner.kind": "ExperimentResultsQueryRunner",
        "update.mode": "incremental-full-refresh",
        "snapshot.type": "standard",
        "query.type": "experiment",
        "query.cached": "true",
      });
    });
  });

  describe("toLogAttrs", () => {
    it("replaces dots with underscores in log keys", () => {
      expect(
        toLogAttrs({
          "runner.kind": "ExperimentResultsQueryRunner",
          "query.type": "experiment",
          "analyses.count": 2,
        }),
      ).toEqual({
        runner_kind: "ExperimentResultsQueryRunner",
        query_type: "experiment",
        analyses_count: 2,
      });
    });
  });

  describe("shouldSampleExperimentUpdateTrace", () => {
    it("never samples when the rate is unset (default 0)", () => {
      // EXPERIMENT_UPDATE_TRACE_SAMPLE_RATE defaults to 0 when the env var is
      // unset, so no experiment-update trace should ever be sampled in tests.
      for (let i = 0; i < 100; i++) {
        expect(shouldSampleExperimentUpdateTrace()).toBe(false);
      }
    });
  });

  describe("instrumentPhase", () => {
    it("parents phases from the ambient active span", async () => {
      const { withActiveRoot, spans } = makeRecordingTracer();

      const result = await withActiveRoot(() =>
        instrumentPhase("parent.phase", {}, async () => {
          await instrumentPhase("child.phase", {}, async () => undefined);
          return "done";
        }),
      );

      expect(result).toBe("done");
      const byName = Object.fromEntries(spans.map((s) => [s.name, s]));
      expect(byName["parent.phase"].parent).toBe("root");
      expect(byName["child.phase"].parent).toBe("parent.phase");
      // Every phase span is finished with an ok status.
      for (const name of ["parent.phase", "child.phase"]) {
        expect(byName[name].ended).toBe(true);
        expect(byName[name].status).toBe("ok");
      }
    });

    it("ends the phase span and marks it errored when fn throws", async () => {
      const { withActiveRoot, spans } = makeRecordingTracer();

      await expect(
        withActiveRoot(() =>
          instrumentPhase("boom", {}, async () => {
            throw new Error("kaboom");
          }),
        ),
      ).rejects.toThrow("kaboom");

      const span = spans.find((s) => s.name === "boom");
      expect(span?.status).toBe("error");
      expect(span?.ended).toBe(true);
    });

    it("creates no spans but still runs fn when no span is active", async () => {
      makeNoopTracer();
      let received: Span | undefined;
      const result = await instrumentPhase("phase", {}, async (span) => {
        received = span;
        return 42;
      });

      expect(received).toBe(noopSpan);
      expect(result).toBe(42);
    });
  });
});
