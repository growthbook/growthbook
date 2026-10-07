/**
 * @jest-environment node
 */
import { Experiment, GrowthBook, GrowthBookClient } from "../src";
import { tracingPlugin } from "../src/plugins/tracing";
import {
  GrowthBookIngestRegion,
  growthbookOtlpExporterConfig,
  TRACING_ATTRIBUTES,
  tracingSpanProcessor,
  withTracingContext,
} from "../src/otel";

class FakeSpan {
  attributes: Record<string, string | string[]> = {};
  setAttribute(key: string, value: string | string[]) {
    this.attributes[key] = value;
    return this;
  }
}

const exp: Experiment<boolean> = {
  key: "my-experiment",
  variations: [false, true],
};

describe("tracingSpanProcessor", () => {
  const processor = tracingSpanProcessor();
  const start = () => {
    const span = new FakeSpan();
    processor.onStart(span);
    return span;
  };

  it("leaves spans outside a tracing context alone", () => {
    expect(start().attributes).toEqual({});
  });

  it("stamps user and conversation ids on every span, across awaits", async () => {
    const spans = await withTracingContext(
      { userId: "u1", conversationId: "c1" },
      async () => {
        const first = start();
        await new Promise((r) => setTimeout(r, 1));
        return [first, start()];
      },
    );

    for (const span of spans) {
      expect(span.attributes).toEqual({
        [TRACING_ATTRIBUTES.userId]: "u1",
        [TRACING_ATTRIBUTES.conversationId]: "c1",
        [TRACING_ATTRIBUTES.sessionId]: "c1",
      });
    }
  });

  it("tags spans with assignments made before they start", () => {
    const gb = new GrowthBook({
      plugins: [tracingPlugin()],
      attributes: { id: "123" },
    });
    const res = gb.run(exp);

    const span = withTracingContext({ gb }, start);

    expect(span.attributes[TRACING_ATTRIBUTES.tags]).toEqual([
      `gb.exp:my-experiment=${res.key}`,
    ]);
    gb.destroy();
  });

  it("retags open spans when an experiment is assigned later", () => {
    const gb = new GrowthBook({ attributes: { id: "123" } });

    const { root, ended } = withTracingContext({ gb }, () => {
      const root = start();
      const ended = start();
      processor.onEnd(ended);
      gb.run(exp);
      return { root, ended };
    });

    expect(root.attributes[TRACING_ATTRIBUTES.tags]).toHaveLength(1);
    expect(ended.attributes[TRACING_ATTRIBUTES.tags]).toBeUndefined();
    gb.destroy();
  });

  it("works with a user-scoped instance from GrowthBookClient", () => {
    const client = new GrowthBookClient({ plugins: [tracingPlugin()] });
    const gb = client.createScopedInstance({ attributes: { id: "123" } });

    const span = withTracingContext({ gb, userId: "123" }, () => {
      gb.runInlineExperiment(exp);
      return start();
    });

    expect(span.attributes[TRACING_ATTRIBUTES.userId]).toBe("123");
    expect(span.attributes[TRACING_ATTRIBUTES.tags]).toHaveLength(1);
    client.destroy();
  });

  it("inherits outer context in nested calls", () => {
    const span = withTracingContext(
      { userId: "u1", conversationId: "c1" },
      () => withTracingContext({ conversationId: "c2" }, start),
    );

    expect(span.attributes[TRACING_ATTRIBUTES.userId]).toBe("u1");
    expect(span.attributes[TRACING_ATTRIBUTES.conversationId]).toBe("c2");
  });

  it("stops retagging after the context finishes", async () => {
    const gb = new GrowthBook({ attributes: { id: "123" } });

    const span = await withTracingContext({ gb }, async () => start());
    gb.run(exp);

    expect(span.attributes[TRACING_ATTRIBUTES.tags]).toBeUndefined();
    gb.destroy();
  });

  it("returns the callback's value and rethrows its errors", async () => {
    expect(withTracingContext({}, () => 42)).toBe(42);
    await expect(
      withTracingContext({}, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});

describe("growthbookOtlpExporterConfig", () => {
  const secretKey = "secret_traceIngest_abc123";

  it("defaults to the us-east-1 ingest host", () => {
    expect(growthbookOtlpExporterConfig({ secretKey })).toEqual({
      url: "https://us-east-1.gb-ingest.com/v1/traces",
      headers: { Authorization: `Bearer ${secretKey}` },
    });
  });

  it("uses the region's ingest host", () => {
    expect(
      growthbookOtlpExporterConfig({ secretKey, region: "eu-west-1" }).url,
    ).toBe("https://eu-west-1.gb-ingest.com/v1/traces");
  });

  it("lets ingestorHost override the region and strips trailing slashes", () => {
    expect(
      growthbookOtlpExporterConfig({
        secretKey,
        region: "eu-west-1",
        ingestorHost: "http://localhost:3003/",
      }).url,
    ).toBe("http://localhost:3003/v1/traces");
  });

  it("accepts keys without the traceIngest prefix", () => {
    expect(
      growthbookOtlpExporterConfig({ secretKey: "secret_abc" }).headers,
    ).toEqual({ Authorization: "Bearer secret_abc" });
  });

  it("requires a secret key", () => {
    expect(() => growthbookOtlpExporterConfig({ secretKey: "" })).toThrow(
      "secretKey is required",
    );
  });

  it("rejects an unknown region", () => {
    expect(() =>
      growthbookOtlpExporterConfig({
        secretKey,
        region: "ap-south-1" as GrowthBookIngestRegion,
      }),
    ).toThrow('unknown region "ap-south-1"');
  });
});
