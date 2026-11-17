import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import {
  OwnParentTracer,
  runInSpan,
} from "back-end/src/services/ingestorTraces";

describe("OwnParentTracer", () => {
  const contextManager = new AsyncLocalStorageContextManager();
  const exporter = new InMemorySpanExporter();
  const provider = new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter })],
  });
  const ours = new OwnParentTracer(provider.getTracer("test"));
  const foreignExporter = new InMemorySpanExporter();
  const foreign = new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter: foreignExporter })],
  }).getTracer("foreign");

  beforeAll(() => {
    context.setGlobalContextManager(contextManager.enable());
  });

  afterAll(() => {
    context.disable();
  });

  beforeEach(() => {
    exporter.reset();
    foreignExporter.reset();
  });

  it("drops foreign parents but keeps its own", async () => {
    const foreignTraceId = await foreign.startActiveSpan(
      "http.request",
      async (request) => {
        await ours.startActiveSpan("ai.generateText", {}, async (root) => {
          await Promise.resolve();
          ours.startActiveSpan("ai.generateText.doGenerate", (child) =>
            child.end(),
          );
          ours.startSpan("ai.toolCall").end();
          root.end();
        });
        request.end();
        return request.spanContext().traceId;
      },
    );

    await provider.forceFlush();
    const spans = Object.fromEntries(
      exporter.getFinishedSpans().map((s) => [s.name, s]),
    );
    const root = spans["ai.generateText"];
    expect(root.parentSpanContext).toBeUndefined();
    expect(root.spanContext().traceId).not.toBe(foreignTraceId);
    for (const name of ["ai.generateText.doGenerate", "ai.toolCall"]) {
      expect(spans[name].parentSpanContext?.spanId).toBe(
        root.spanContext().spanId,
      );
      expect(spans[name].spanContext().traceId).toBe(
        root.spanContext().traceId,
      );
    }
  });

  it("leaves foreign spans under the request span", async () => {
    await foreign.startActiveSpan("http.request", async (request) => {
      await runInSpan(ours, "job refresh", {}, async () =>
        foreign.startActiveSpan("pg.query", (span) => span.end()),
      );
      request.end();
    });

    const [job] = exporter.getFinishedSpans();
    const spans = Object.fromEntries(
      foreignExporter.getFinishedSpans().map((s) => [s.name, s]),
    );
    const request = spans["http.request"];
    const query = spans["pg.query"];
    expect(job.name).toBe("job refresh");
    expect(query.parentSpanContext?.spanId).toBe(request.spanContext().spanId);
    expect(query.spanContext().traceId).toBe(request.spanContext().traceId);
  });

  it("starts a new trace outside any request", async () => {
    ours.startActiveSpan("ai.streamText", (span) => span.end());
    await provider.forceFlush();
    expect(exporter.getFinishedSpans()[0].parentSpanContext).toBeUndefined();
    expect(trace.getActiveSpan()).toBeUndefined();
  });

  it("nests AI calls under queries under jobs", async () => {
    await foreign.startActiveSpan("http.request", async (request) => {
      await runInSpan(ours, "job update_single_experiment", {}, () =>
        runInSpan(ours, "query experimentMetric", {}, async () => {
          ours.startActiveSpan("ai.generateText", (span) => span.end());
        }),
      );
      request.end();
    });

    await provider.forceFlush();
    const spans = Object.fromEntries(
      exporter.getFinishedSpans().map((s) => [s.name, s]),
    );
    const job = spans["job update_single_experiment"];
    const query = spans["query experimentMetric"];
    expect(job.parentSpanContext).toBeUndefined();
    expect(query.parentSpanContext?.spanId).toBe(job.spanContext().spanId);
    expect(spans["ai.generateText"].parentSpanContext?.spanId).toBe(
      query.spanContext().spanId,
    );
  });

  it("records errors and rethrows them", async () => {
    await expect(
      runInSpan(ours, "query failing", {}, async () => {
        throw new Error("Table not found");
      }),
    ).rejects.toThrow("Table not found");

    const [span] = exporter.getFinishedSpans();
    expect(span.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: "Table not found",
    });
    expect(span.events[0].name).toBe("exception");
    expect(span.events[0].attributes?.["exception.message"]).toBe(
      "Table not found",
    );
  });
});
