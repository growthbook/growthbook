import { record, type eventWithTime } from "rrweb";
import { GrowthBook } from "../../src";
import { sessionReplayPlugin } from "../../src/plugins/session-replay";
import { _resetSampleDecisionsForTests } from "../../src/plugins/utils/sampling";

jest.mock("rrweb", () => ({ record: jest.fn() }));

// No-op stubs — privacy config and URL scrubbing have their own unit tests
jest.mock("../../src/plugins/session-replay/privacy", () => ({
  buildRrwebPrivacyOptions: () => ({}),
}));
jest.mock("../../src/plugins/session-replay/url-scrub", () => ({
  scrubEventUrls: (event: unknown) => event,
}));

const mockRecord = record as jest.MockedFunction<typeof record>;

// Real setTimeout, captured before jest.useFakeTimers(): a real macrotask
// drains every pending microtask without advancing the fake clock
const realSetTimeout = global.setTimeout.bind(global);
const flushMicrotasks = () => new Promise<void>((r) => realSetTimeout(r, 0));

// Minimal rrweb events needed to pass flushBuffer's early-exit guards:
//   type 2 = FullSnapshot  — required for chunk 0 (chunkIndex === 0 check)
//   type 3 source 2 = MouseInteraction — sets hasUserInteraction = true
const SNAPSHOT_EVENT = {
  type: 2,
  timestamp: 1000,
  data: {},
} as unknown as eventWithTime;

const INTERACTION_EVENT = {
  type: 3,
  timestamp: 1001,
  data: { source: 2 },
} as unknown as eventWithTime;

const INGESTOR_HOST = "https://ingest.example.com";

function buildGrowthBook(ready = true) {
  return new GrowthBook({
    clientKey: "sdk-test-key",
    apiHost: "https://cdn.example.com",
    // A payload marks the instance ready, so the plugin auto-starts on apply
    ...(ready ? { features: {} } : {}),
    attributes: {
      session_id: "customer-session-id",
      session_replay_id: "user-supplied-replay-id",
    },
  });
}

function seedSessionReplayId(sessionReplayId: string) {
  sessionStorage.setItem(
    "gb_session_replay_id",
    JSON.stringify({
      gb_session_replay_id: sessionReplayId,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    }),
  );
}

function makeLargeEvent(
  approxBytes: number,
  type: number = 3,
  source: number = 0,
): eventWithTime {
  const padding = "x".repeat(Math.max(0, approxBytes - 80));
  return {
    type,
    timestamp: Date.now(),
    data: { source, payload: padding },
  } as unknown as eventWithTime;
}

describe("sessionReplayPlugin — chunked flush for oversized buffers", () => {
  let gb: GrowthBook;
  let emitEvent: (event: eventWithTime) => void;

  beforeEach(() => {
    jest.useFakeTimers();
    mockRecord.mockClear();
    seedSessionReplayId("f47ac10b-58cc-4372-a567-0e02b2c3d479");

    mockRecord.mockImplementation((options) => {
      emitEvent = (options as { emit: (e: eventWithTime) => void }).emit;
      return jest.fn();
    });

    gb = buildGrowthBook();

    const plugin = sessionReplayPlugin({
      ingestorHost: INGESTOR_HOST,
      autoRecord: false,
    });
    plugin(gb);
    gb.startSessionReplay();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete (global as unknown as Record<string, unknown>).fetch;
    gb.destroy();
    sessionStorage.clear();
    _resetSampleDecisionsForTests();
  });

  it("splits an oversized buffer into multiple fetch calls with incrementing chunkIndex", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    global.fetch = fetchMock;

    emitEvent(SNAPSHOT_EVENT);
    emitEvent(makeLargeEvent(200_000));
    emitEvent(makeLargeEvent(200_000));
    emitEvent(makeLargeEvent(200_000));

    emitEvent(INTERACTION_EVENT);
    await flushMicrotasks();

    // Snapshot isolated into chunk 0, then ~600KB of large events
    // partitioned into further batches
    expect(fetchMock.mock.calls.length).toBe(3);

    const chunkIndices = fetchMock.mock.calls.map((call) => {
      const body = JSON.parse(call[1].body as string) as {
        chunkIndex: number;
      };
      return body.chunkIndex;
    });
    expect(chunkIndices).toEqual([0, 1, 2]);
  });

  it("sends a single oversized event in its own batch without splitting it", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    global.fetch = fetchMock;

    emitEvent(SNAPSHOT_EVENT);
    emitEvent(makeLargeEvent(512 * 1024 + 100_000));

    emitEvent(INTERACTION_EVENT);
    await flushMicrotasks();

    // Snapshot in batch 0, oversized event in batch 1
    expect(fetchMock.mock.calls.length).toBe(2);

    const allEvents = fetchMock.mock.calls.flatMap((call) => {
      const body = JSON.parse(call[1].body as string) as {
        events: unknown[];
      };
      return body.events;
    });
    // snapshot + large event (interaction lands in buffer after flush)
    expect(allEvents.length).toBe(2);
  });

  it("sends metadata only with the first chunk in a multi-chunk flush", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    global.fetch = fetchMock;

    emitEvent(SNAPSHOT_EVENT);
    emitEvent(makeLargeEvent(200_000));
    emitEvent(makeLargeEvent(200_000));
    emitEvent(makeLargeEvent(200_000));

    emitEvent(INTERACTION_EVENT);
    await flushMicrotasks();

    expect(fetchMock.mock.calls.length).toBe(3);

    // First chunk carries metadata
    const firstBody = JSON.parse(
      fetchMock.mock.calls[0][1].body as string,
    ) as Record<string, unknown>;
    expect(firstBody).toHaveProperty("featureEvals");
    expect(firstBody).toHaveProperty("experimentEvals");
    expect(firstBody).toHaveProperty("sessionEvents");

    // Subsequent chunks have empty metadata arrays
    for (let i = 1; i < fetchMock.mock.calls.length; i++) {
      const body = JSON.parse(fetchMock.mock.calls[i][1].body as string) as {
        featureEvals: { items: unknown[] };
        experimentEvals: { items: unknown[] };
        sessionEvents: { items: unknown[] };
      };
      expect(body.featureEvals.items).toEqual([]);
      expect(body.experimentEvals.items).toEqual([]);
      expect(body.sessionEvents.items).toEqual([]);
    }
  });

  it("continues sending remaining batches after one chunk is permanently rejected", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 413,
        statusText: "Payload Too Large",
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
      } as Response);
    global.fetch = fetchMock;

    emitEvent(SNAPSHOT_EVENT);
    emitEvent(makeLargeEvent(200_000));
    emitEvent(makeLargeEvent(200_000));
    emitEvent(makeLargeEvent(200_000));
    emitEvent(makeLargeEvent(200_000));
    emitEvent(makeLargeEvent(200_000));

    emitEvent(INTERACTION_EVENT);
    await flushMicrotasks();

    // All batches attempted even though one got 413
    expect(fetchMock.mock.calls.length).toBe(4);
  });

  it("keeps the full snapshot in the first batch (chunkIndex=0)", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    global.fetch = fetchMock;

    const META_EVENT = {
      type: 4,
      timestamp: 999,
      data: { href: "http://localhost", width: 1024, height: 768 },
    } as unknown as eventWithTime;

    emitEvent(META_EVENT);
    emitEvent(SNAPSHOT_EVENT);
    emitEvent(makeLargeEvent(200_000));
    emitEvent(makeLargeEvent(200_000));
    emitEvent(makeLargeEvent(200_000));

    emitEvent(INTERACTION_EVENT);
    await flushMicrotasks();

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      chunkIndex: number;
      events: Array<{ type: number }>;
    };
    expect(firstBody.chunkIndex).toBe(0);
    expect(firstBody.events.some((e) => e.type === 2)).toBe(true);
  });

  it("sends a normal-sized buffer as a single chunk (no behavior change)", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    global.fetch = fetchMock;

    emitEvent(SNAPSHOT_EVENT);
    emitEvent(INTERACTION_EVENT);

    jest.runOnlyPendingTimers();
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("sessionReplayPlugin — remote settings and sampling", () => {
  let gb: GrowthBook;

  beforeEach(() => {
    mockRecord.mockClear();
    mockRecord.mockImplementation(() => jest.fn());
    seedSessionReplayId("f47ac10b-58cc-4372-a567-0e02b2c3d479");
    gb = buildGrowthBook();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    gb.destroy();
    sessionStorage.clear();
    _resetSampleDecisionsForTests();
  });

  it("payload kill switch stops an in-flight recording and re-enables later", async () => {
    let stopped = false;
    mockRecord.mockImplementation(() => () => {
      stopped = true;
    });
    sessionReplayPlugin({ ingestorHost: INGESTOR_HOST })(gb);
    expect(mockRecord).toHaveBeenCalledTimes(1);

    await gb.setPayload({ sdkSettings: { sessionReplay: { enabled: false } } });
    expect(stopped).toBe(true);

    await gb.setPayload({ sdkSettings: { sessionReplay: { enabled: true } } });
    expect(mockRecord).toHaveBeenCalledTimes(2);
  });

  it("payload samplingRate applies over the constructor value", async () => {
    await gb.setPayload({
      sdkSettings: { sessionReplay: { samplingRate: 0 } },
    });
    sessionReplayPlugin({ ingestorHost: INGESTOR_HOST, samplingRate: 1 })(gb);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("unsampled sessions don't record; startSessionReplay() forces one", () => {
    jest.spyOn(Math, "random").mockReturnValue(0.99);
    sessionReplayPlugin({ ingestorHost: INGESTOR_HOST, samplingRate: 0.5 })(gb);
    expect(mockRecord).not.toHaveBeenCalled();

    gb.startSessionReplay();
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  it("the sampling decision sticks for the session across plugin inits", () => {
    jest.spyOn(Math, "random").mockReturnValue(0.99);
    sessionReplayPlugin({ ingestorHost: INGESTOR_HOST, samplingRate: 0.5 })(gb);
    expect(mockRecord).not.toHaveBeenCalled();
    gb.destroy();

    // Same replay session, now with a winning roll — the stored "out"
    // decision must win
    jest.spyOn(Math, "random").mockReturnValue(0.01);
    gb = buildGrowthBook();
    sessionReplayPlugin({ ingestorHost: INGESTOR_HOST, samplingRate: 0.5 })(gb);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("a remote payload without an enabled key leaves a locally-enabled plugin on", async () => {
    await gb.setPayload({
      sdkSettings: { sessionReplay: { samplingRate: 1 } },
    });
    sessionReplayPlugin({ ingestorHost: INGESTOR_HOST })(gb);
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  it("a remote enabled:true cannot override a constructor enabled:false", async () => {
    await gb.setPayload({ sdkSettings: { sessionReplay: { enabled: true } } });
    sessionReplayPlugin({ ingestorHost: INGESTOR_HOST, enabled: false })(gb);
    expect(mockRecord).not.toHaveBeenCalled();

    await gb.setPayload({ sdkSettings: { sessionReplay: { enabled: true } } });
    gb.startSessionReplay();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("a remote samplingRate overrides the constructor value in either direction", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0.5);
    await gb.setPayload({
      sdkSettings: { sessionReplay: { samplingRate: 1 } },
    });
    sessionReplayPlugin({ ingestorHost: INGESTOR_HOST, samplingRate: 0.1 })(gb);
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  it("an invalid remote samplingRate is ignored with a warning", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await gb.setPayload({
      sdkSettings: { sessionReplay: { samplingRate: -1 } },
    });
    sessionReplayPlugin({ ingestorHost: INGESTOR_HOST })(gb);
    expect(mockRecord).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("sdkSettings.sessionReplay.samplingRate"),
    );
  });

  it("the hard cap rotates a recording that never saw an interaction", () => {
    jest.useFakeTimers();
    sessionReplayPlugin({ ingestorHost: INGESTOR_HOST })(gb);
    expect(mockRecord).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(31 * 60 * 1000);
    expect(mockRecord).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it("waits for the payload so remote settings decide the first sampling roll", async () => {
    gb.destroy();
    gb = buildGrowthBook(false);
    sessionReplayPlugin({ ingestorHost: INGESTOR_HOST })(gb);
    expect(mockRecord).not.toHaveBeenCalled();

    await gb.setPayload({
      sdkSettings: { sessionReplay: { samplingRate: 0 } },
    });
    expect(mockRecord).not.toHaveBeenCalled();

    gb.destroy();
    sessionStorage.clear();
    _resetSampleDecisionsForTests();
    gb = buildGrowthBook(false);
    sessionReplayPlugin({ ingestorHost: INGESTOR_HOST })(gb);
    await gb.setPayload({});
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  it("kill switch beats a forced start", () => {
    sessionReplayPlugin({ ingestorHost: INGESTOR_HOST, enabled: false })(gb);
    gb.startSessionReplay();
    expect(mockRecord).not.toHaveBeenCalled();
  });
});

describe("sessionReplayPlugin — stopRecording keepalive flush", () => {
  let gb: GrowthBook;
  let emitEvent: (event: eventWithTime) => void;

  beforeEach(() => {
    jest.useFakeTimers();
    mockRecord.mockClear();
    seedSessionReplayId("f47ac10b-58cc-4372-a567-0e02b2c3d479");

    // Expose rrweb's emit callback so tests can push events into the buffer
    mockRecord.mockImplementation((options) => {
      emitEvent = (options as { emit: (e: eventWithTime) => void }).emit;
      return jest.fn(); // rrweb stop function
    });

    gb = buildGrowthBook();

    const plugin = sessionReplayPlugin({
      ingestorHost: INGESTOR_HOST,
      autoRecord: false, // tests call startSessionReplay() explicitly
    });
    plugin(gb);

    gb.startSessionReplay();

    // Seed the buffer: snapshot satisfies the chunk-0 guard; interaction
    // flips hasUserInteraction so flushBuffer won't exit early.
    emitEvent(SNAPSHOT_EVENT);
    emitEvent(INTERACTION_EVENT);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete (global as unknown as Record<string, unknown>).fetch;
    gb.destroy();
    sessionStorage.clear();
    _resetSampleDecisionsForTests();
  });

  it("fires a keepalive flush after stopRecording cancels an in-flight retry sleep", async () => {
    // First call: 5xx triggers retry backoff sleep. Second call: keepalive flush.
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
      } as Response);
    global.fetch = fetchMock;

    // Fire the flush interval → flushBuffer → sendWithRetry → fetch (503)
    // → retry backoff sleep is now pending (fake setTimeout), _cancelFn set
    jest.runOnlyPendingTimers();
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    // stopRecording calls cancel(), which rejects the retry-sleep promise as a
    // microtask. The void flushBuffer() immediately after is a no-op because
    // flushInFlight is still true at that point. Once the microtask fires,
    // flushBuffer's finally block detects !isRecording + buffered events and
    // issues the keepalive flush itself.
    gb.stopSessionReplay();
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      `${INGESTOR_HOST}/ingest/session-replay`,
    );
  });

  it("fires a single flush when stopRecording is called with no retry in progress", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    global.fetch = fetchMock;

    // No flush in flight — stopRecording fires void flushBuffer() directly.
    gb.stopSessionReplay();
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${INGESTOR_HOST}/ingest/session-replay`,
    );
  });

  it("does not flush when the buffer is already empty at stop time", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200 } as Response);
    global.fetch = fetchMock;

    // Drain the buffer via the periodic flush interval.
    jest.runOnlyPendingTimers();
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();

    // Buffer is empty — neither the void flushBuffer() in stopRecording nor
    // the finally-block guard should trigger a fetch.
    gb.stopSessionReplay();
    await flushMicrotasks();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends session_replay_id as a top-level payload field", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    global.fetch = fetchMock;

    gb.stopSessionReplay();
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      fetchMock.mock.calls[0][1].body as string,
    ) as Record<string, unknown>;
    expect(body.session_replay_id).toBe("f47ac10b-58cc-4372-a567-0e02b2c3d479");
    expect(body).not.toHaveProperty("sessionId");
    expect(
      JSON.parse((body.context as { attributes: string }).attributes),
    ).toEqual(
      expect.objectContaining({
        session_id: "customer-session-id",
        session_replay_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      }),
    );
  });

  it("rotates session_replay_id in sessionStorage for a new replay session", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    global.fetch = fetchMock;

    const initialStored = JSON.parse(
      sessionStorage.getItem("gb_session_replay_id") || "{}",
    ) as { gb_session_replay_id?: string };

    jest.advanceTimersByTime(31 * 60 * 1000);
    await flushMicrotasks();

    const rotatedStored = JSON.parse(
      sessionStorage.getItem("gb_session_replay_id") || "{}",
    ) as { gb_session_replay_id?: string };
    expect(rotatedStored.gb_session_replay_id).toBeTruthy();
    expect(rotatedStored.gb_session_replay_id).not.toBe(
      initialStored.gb_session_replay_id,
    );
    expect(mockRecord).toHaveBeenCalledTimes(2);
  });
});

describe("sessionReplayPlugin — flush pipeline", () => {
  let gb: GrowthBook;
  let emitEvent: (event: eventWithTime) => void;

  beforeEach(() => {
    jest.useFakeTimers();
    mockRecord.mockClear();
    seedSessionReplayId("f47ac10b-58cc-4372-a567-0e02b2c3d479");

    mockRecord.mockImplementation((options) => {
      emitEvent = (options as { emit: (e: eventWithTime) => void }).emit;
      return jest.fn();
    });

    gb = buildGrowthBook();

    const plugin = sessionReplayPlugin({
      ingestorHost: INGESTOR_HOST,
      autoRecord: false,
    });
    plugin(gb);
    gb.startSessionReplay();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete (global as unknown as Record<string, unknown>).fetch;
    gb.destroy();
    sessionStorage.clear();
    _resetSampleDecisionsForTests();
  });

  it("periodic flush sends buffered events with correct payload shape", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    global.fetch = fetchMock;

    emitEvent(SNAPSHOT_EVENT);
    emitEvent(INTERACTION_EVENT);

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`${INGESTOR_HOST}/ingest/session-replay`);
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body.clientKey).toBe("sdk-test-key");
    expect(body.session_replay_id).toBe("f47ac10b-58cc-4372-a567-0e02b2c3d479");
    expect(body.chunkIndex).toBe(0);
    expect(body.sessionStartedAt).toEqual(expect.any(Number));
    expect(body.viewport).toEqual({
      width: expect.any(Number),
      height: expect.any(Number),
    });
    expect(body.events).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 2 })]),
    );
    expect(body.context).toHaveProperty("attributes");
    expect(body.featureEvals).toHaveProperty("items");
    expect(body.experimentEvals).toHaveProperty("items");
    expect(body.sessionEvents).toHaveProperty("items");
  });

  it("chunkIndex increments across successive flushes", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    global.fetch = fetchMock;

    emitEvent(SNAPSHOT_EVENT);
    emitEvent(INTERACTION_EVENT);

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(fetchMock.mock.calls[0][1].body as string).chunkIndex,
    ).toBe(0);

    // More events for the second flush
    emitEvent({
      type: 3,
      timestamp: 2000,
      data: { source: 0 },
    } as unknown as eventWithTime);

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(fetchMock.mock.calls[1][1].body as string).chunkIndex,
    ).toBe(1);
  });

  it("skips flush when no user interaction has occurred", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    global.fetch = fetchMock;

    emitEvent(SNAPSHOT_EVENT);

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips flush when buffer is empty", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    global.fetch = fetchMock;

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips flush when chunk 0 has no full snapshot", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    global.fetch = fetchMock;

    emitEvent(INTERACTION_EVENT);

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("includes feature evals, experiment evals, and session events in the payload", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    global.fetch = fetchMock;

    emitEvent(SNAPSHOT_EVENT);
    emitEvent(INTERACTION_EVENT);

    await gb.setPayload({
      features: { "test-flag": { defaultValue: true } },
    });
    gb.evalFeature("test-flag");
    gb.run({
      key: "test-exp",
      variations: ["control", "variant"],
      hashAttribute: "session_id",
    });
    await gb.logEvent("test-event", { foo: "bar" });

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      featureEvals: { items: Array<{ featureKey: string }> };
      experimentEvals: { items: Array<{ key: string }> };
      sessionEvents: { items: Array<{ eventName: string }> };
    };

    expect(body.featureEvals.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ featureKey: "test-flag" }),
      ]),
    );
    expect(body.experimentEvals.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "test-exp" })]),
    );
    expect(body.sessionEvents.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "test-event" }),
      ]),
    );
  });

  it("resolves gb_session_id from the session_id attribute", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    global.fetch = fetchMock;

    emitEvent(SNAPSHOT_EVENT);
    emitEvent(INTERACTION_EVENT);

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      gb_session_id: string;
    };
    expect(body.gb_session_id).toBe("customer-session-id");
  });
});

describe("sessionReplayPlugin — session rotation safety", () => {
  let gb: GrowthBook;
  let emitEvent: (event: eventWithTime) => void;

  beforeEach(() => {
    jest.useFakeTimers();
    mockRecord.mockClear();
    seedSessionReplayId("f47ac10b-58cc-4372-a567-0e02b2c3d479");

    mockRecord.mockImplementation((options) => {
      emitEvent = (options as { emit: (e: eventWithTime) => void }).emit;
      return jest.fn();
    });

    gb = buildGrowthBook();

    const plugin = sessionReplayPlugin({
      ingestorHost: INGESTOR_HOST,
      autoRecord: false,
    });
    plugin(gb);
    gb.startSessionReplay();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete (global as unknown as Record<string, unknown>).fetch;
    gb.destroy();
    sessionStorage.clear();
    _resetSampleDecisionsForTests();
  });

  it("stops sending batches when session rotates during a multi-batch flush", async () => {
    const originalId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    jest.spyOn(console, "warn").mockImplementation(() => {});

    let firstCallDone = false;
    const fetchMock = jest.fn().mockImplementation(() => {
      if (!firstCallDone) {
        firstCallDone = true;
        // Advance past the 30-min hard cap inside the first fetch to
        // trigger checkAndRotate → stopRecording + startRecording(true)
        jest.advanceTimersByTime(31 * 60 * 1000);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
      } as Response);
    });
    global.fetch = fetchMock;

    // Build an oversized buffer that partitions into 3+ batches
    emitEvent(SNAPSHOT_EVENT);
    emitEvent(makeLargeEvent(200_000));
    emitEvent(makeLargeEvent(200_000));
    emitEvent(makeLargeEvent(200_000));
    emitEvent(INTERACTION_EVENT);

    // The byte-size overflow in the interaction emit triggers flushBuffer
    await flushMicrotasks();

    const sentBodies = fetchMock.mock.calls.map(
      (call) =>
        JSON.parse(call[1].body as string) as {
          session_replay_id: string;
          chunkIndex: number;
        },
    );

    // First batch sent under the original session
    expect(sentBodies[0].session_replay_id).toBe(originalId);
    expect(sentBodies[0].chunkIndex).toBe(0);

    // No batch was ever sent under the rotated session's ID
    const wrongSession = sentBodies.filter(
      (b) => b.session_replay_id !== originalId,
    );
    expect(wrongSession).toHaveLength(0);
  });

  it("new session after rotation flushes only its own events", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    global.fetch = fetchMock;

    const originalId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

    // Flush the first session
    emitEvent(SNAPSHOT_EVENT);
    emitEvent(INTERACTION_EVENT);

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(fetchMock.mock.calls[0][1].body as string).session_replay_id,
    ).toBe(originalId);

    fetchMock.mockClear();

    // Hard-cap rotation
    jest.advanceTimersByTime(31 * 60 * 1000);
    await flushMicrotasks();

    expect(mockRecord).toHaveBeenCalledTimes(2);

    // Emit events for the new session
    emitEvent(SNAPSHOT_EVENT);
    emitEvent(INTERACTION_EVENT);

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    // Find the new session's flush (different session_replay_id)
    const newSessionCalls = fetchMock.mock.calls.filter((call) => {
      const body = JSON.parse(call[1].body as string) as {
        session_replay_id: string;
      };
      return body.session_replay_id !== originalId;
    });

    expect(newSessionCalls.length).toBeGreaterThanOrEqual(1);
    const newBody = JSON.parse(newSessionCalls[0][1].body as string) as {
      chunkIndex: number;
      events: unknown[];
    };
    // Fresh session starts at chunk 0 with only its own events
    expect(newBody.chunkIndex).toBe(0);
    expect(newBody.events).toHaveLength(2);
  });
});
