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
  // Settings resolution, not start timing: "deferred start" covers the default
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
    sessionReplayPlugin({
      ingestorHost: INGESTOR_HOST,
      startMode: "immediate",
    })(gb);
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
    sessionReplayPlugin({
      ingestorHost: INGESTOR_HOST,
      startMode: "immediate",
      samplingRate: 1,
    })(gb);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("unsampled sessions don't record; startSessionReplay() forces one", () => {
    jest.spyOn(Math, "random").mockReturnValue(0.99);
    sessionReplayPlugin({
      ingestorHost: INGESTOR_HOST,
      startMode: "immediate",
      samplingRate: 0.5,
    })(gb);
    expect(mockRecord).not.toHaveBeenCalled();

    gb.startSessionReplay();
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  it("the sampling decision sticks for the session across plugin inits", () => {
    jest.spyOn(Math, "random").mockReturnValue(0.99);
    sessionReplayPlugin({
      ingestorHost: INGESTOR_HOST,
      startMode: "immediate",
      samplingRate: 0.5,
    })(gb);
    expect(mockRecord).not.toHaveBeenCalled();
    gb.destroy();

    // Same replay session, now with a winning roll — the stored "out"
    // decision must win
    jest.spyOn(Math, "random").mockReturnValue(0.01);
    gb = buildGrowthBook();
    sessionReplayPlugin({
      ingestorHost: INGESTOR_HOST,
      startMode: "immediate",
      samplingRate: 0.5,
    })(gb);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("a remote payload without an enabled key leaves a locally-enabled plugin on", async () => {
    await gb.setPayload({
      sdkSettings: { sessionReplay: { samplingRate: 1 } },
    });
    sessionReplayPlugin({
      ingestorHost: INGESTOR_HOST,
      startMode: "immediate",
    })(gb);
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  it("a remote enabled:true cannot override a constructor enabled:false", async () => {
    await gb.setPayload({ sdkSettings: { sessionReplay: { enabled: true } } });
    sessionReplayPlugin({
      ingestorHost: INGESTOR_HOST,
      startMode: "immediate",
      enabled: false,
    })(gb);
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
    sessionReplayPlugin({
      ingestorHost: INGESTOR_HOST,
      startMode: "immediate",
      samplingRate: 0.1,
    })(gb);
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  it("an invalid remote samplingRate is ignored with a warning", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await gb.setPayload({
      sdkSettings: { sessionReplay: { samplingRate: -1 } },
    });
    sessionReplayPlugin({
      ingestorHost: INGESTOR_HOST,
      startMode: "immediate",
    })(gb);
    expect(mockRecord).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("sdkSettings.sessionReplay.samplingRate"),
    );
  });

  it("the hard cap rotates a recording that never saw an interaction", () => {
    jest.useFakeTimers();
    sessionReplayPlugin({
      ingestorHost: INGESTOR_HOST,
      startMode: "immediate",
    })(gb);
    expect(mockRecord).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(31 * 60 * 1000);
    expect(mockRecord).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it("waits for the payload so remote settings decide the first sampling roll", async () => {
    gb.destroy();
    gb = buildGrowthBook(false);
    sessionReplayPlugin({
      ingestorHost: INGESTOR_HOST,
      startMode: "immediate",
    })(gb);
    expect(mockRecord).not.toHaveBeenCalled();

    await gb.setPayload({
      sdkSettings: { sessionReplay: { samplingRate: 0 } },
    });
    expect(mockRecord).not.toHaveBeenCalled();

    gb.destroy();
    sessionStorage.clear();
    _resetSampleDecisionsForTests();
    gb = buildGrowthBook(false);
    sessionReplayPlugin({
      ingestorHost: INGESTOR_HOST,
      startMode: "immediate",
    })(gb);
    await gb.setPayload({});
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  it("kill switch beats a forced start", () => {
    sessionReplayPlugin({
      ingestorHost: INGESTOR_HOST,
      startMode: "immediate",
      enabled: false,
    })(gb);
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

  it("omits experiments the user was not exposed to", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    global.fetch = fetchMock;

    emitEvent(SNAPSHOT_EVENT);
    emitEvent(INTERACTION_EVENT);

    gb.run({
      key: "exposed-exp",
      variations: ["control", "variant"],
      hashAttribute: "session_id",
    });
    // Coverage 0 never buckets, so this evaluates but never becomes an exposure
    gb.run({
      key: "unexposed-exp",
      variations: ["control", "variant"],
      hashAttribute: "session_id",
      coverage: 0,
    });

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      experimentEvals: { items: Array<{ key: string }> };
    };
    const keys = body.experimentEvals.items.map((i) => i.key);
    expect(keys).toContain("exposed-exp");
    expect(keys).not.toContain("unexposed-exp");
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

  it("finishes every batch under the old id when the session rotates mid-flush", async () => {
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

    // The rotation must not truncate the flush: the snapshot chunk is
    // worthless on its own, so every batch still ships under the old id
    expect(sentBodies.length).toBeGreaterThan(1);
    expect(sentBodies.every((b) => b.session_replay_id === originalId)).toBe(
      true,
    );
    expect(sentBodies.map((b) => b.chunkIndex)).toEqual(
      sentBodies.map((_, i) => i),
    );
  });

  it("does not let a rotated-through flush clobber the new session's chunk state", async () => {
    const originalId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    jest.spyOn(console, "warn").mockImplementation(() => {});

    let firstCallDone = false;
    const fetchMock = jest.fn().mockImplementation(() => {
      if (!firstCallDone) {
        firstCallDone = true;
        jest.advanceTimersByTime(31 * 60 * 1000);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
      } as Response);
    });
    global.fetch = fetchMock;

    emitEvent(SNAPSHOT_EVENT);
    emitEvent(makeLargeEvent(200_000));
    emitEvent(makeLargeEvent(200_000));
    emitEvent(makeLargeEvent(200_000));
    emitEvent(INTERACTION_EVENT);

    // Drain until the rotated-through flush has sent every remaining batch
    for (let i = 0; i < 10; i++) await flushMicrotasks();

    // Those post-rotation sends must not write their chunk cursor back over
    // the new recording's freshly-initialised state
    const persisted = JSON.parse(
      sessionStorage.getItem("gb_session_replay") || "{}",
    ) as { sessionReplayId?: string; lastChunkIndex?: number };

    expect(persisted.sessionReplayId).toBeTruthy();
    expect(persisted.sessionReplayId).not.toBe(originalId);
    expect(persisted.lastChunkIndex).toBe(-1);
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

describe("sessionReplayPlugin — deferred start", () => {
  let gb: GrowthBook;

  beforeEach(() => {
    jest.useFakeTimers();
    mockRecord.mockClear();
    mockRecord.mockImplementation(() => jest.fn());
    seedSessionReplayId("f47ac10b-58cc-4372-a567-0e02b2c3d479");
    gb = buildGrowthBook();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete (window as unknown as Record<string, unknown>).requestIdleCallback;
    delete (window as unknown as Record<string, unknown>).cancelIdleCallback;
    delete (document as unknown as Record<string, unknown>).readyState;
    delete (document as unknown as Record<string, unknown>).prerendering;
    gb.destroy();
    sessionStorage.clear();
    _resetSampleDecisionsForTests();
  });

  it("does not snapshot synchronously; starts on the next idle task", () => {
    sessionReplayPlugin({ ingestorHost: INGESTOR_HOST })(gb);
    expect(mockRecord).not.toHaveBeenCalled();

    jest.runOnlyPendingTimers();
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  it("keeps the snapshot out of setPayload", async () => {
    gb.destroy();
    gb = buildGrowthBook(false);
    sessionReplayPlugin({ ingestorHost: INGESTOR_HOST })(gb);

    await gb.setPayload({});
    expect(mockRecord).not.toHaveBeenCalled();

    jest.runOnlyPendingTimers();
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  it("uses requestIdleCallback with a timeout when available", () => {
    const ric = jest.fn((cb: () => void) => {
      cb();
      return 1;
    });
    Object.assign(window, { requestIdleCallback: ric });

    sessionReplayPlugin({ ingestorHost: INGESTOR_HOST })(gb);
    expect(ric).toHaveBeenCalledWith(expect.any(Function), { timeout: 2000 });
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  it("waits for the load event while the document is still loading", () => {
    Object.defineProperty(document, "readyState", {
      configurable: true,
      get: () => "interactive",
    });
    sessionReplayPlugin({ ingestorHost: INGESTOR_HOST })(gb);
    jest.runOnlyPendingTimers();
    expect(mockRecord).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("load"));
    jest.runOnlyPendingTimers();
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  it("waits for a prerendered page to activate", () => {
    Object.defineProperty(document, "prerendering", {
      configurable: true,
      value: true,
    });
    sessionReplayPlugin({ ingestorHost: INGESTOR_HOST })(gb);
    jest.runOnlyPendingTimers();
    expect(mockRecord).not.toHaveBeenCalled();

    document.dispatchEvent(new Event("prerenderingchange"));
    jest.runOnlyPendingTimers();
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  it("a kill switch arriving before the deferred start cancels it", async () => {
    sessionReplayPlugin({ ingestorHost: INGESTOR_HOST })(gb);
    await gb.setPayload({ sdkSettings: { sessionReplay: { enabled: false } } });
    jest.runOnlyPendingTimers();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("destroy cancels a pending start", () => {
    sessionReplayPlugin({ ingestorHost: INGESTOR_HOST })(gb);
    gb.destroy();
    jest.runOnlyPendingTimers();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("startSessionReplay() starts at once and supersedes a pending start", () => {
    sessionReplayPlugin({ ingestorHost: INGESTOR_HOST })(gb);
    gb.startSessionReplay();
    expect(mockRecord).toHaveBeenCalledTimes(1);

    jest.runOnlyPendingTimers();
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  it("repeated payload updates schedule a single start", async () => {
    sessionReplayPlugin({ ingestorHost: INGESTOR_HOST })(gb);
    await gb.setPayload({});
    await gb.setPayload({});
    jest.runOnlyPendingTimers();
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  it("latches an interaction that lands before the deferred start", async () => {
    let emitEvent: (event: eventWithTime) => void = () => undefined;
    mockRecord.mockImplementation((options) => {
      emitEvent = (options as { emit: (e: eventWithTime) => void }).emit;
      return jest.fn();
    });
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    global.fetch = fetchMock;

    sessionReplayPlugin({ ingestorHost: INGESTOR_HOST })(gb);
    document.dispatchEvent(new Event("pointerdown"));
    jest.runOnlyPendingTimers();
    expect(mockRecord).toHaveBeenCalledTimes(1);

    // Snapshot only: rrweb never saw the click, so without the latch
    // hasUserInteraction stays false and the replay is never uploaded
    emitEvent(SNAPSHOT_EVENT);
    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalled();
    delete (global as unknown as Record<string, unknown>).fetch;
  });
});

describe("sessionReplayPlugin — pause until first interaction", () => {
  let gb: GrowthBook;
  let emitEvent: (event: eventWithTime) => void;
  let stopFns: jest.Mock[];
  let fetchMock: jest.Mock;

  const MUTATION_EVENT = {
    type: 3,
    timestamp: 1002,
    data: { source: 0 },
  } as unknown as eventWithTime;

  beforeEach(() => {
    jest.useFakeTimers();
    mockRecord.mockClear();
    stopFns = [];
    seedSessionReplayId("f47ac10b-58cc-4372-a567-0e02b2c3d479");
    mockRecord.mockImplementation((options) => {
      emitEvent = (options as { emit: (e: eventWithTime) => void }).emit;
      const stop = jest.fn();
      stopFns.push(stop);
      return stop;
    });
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    global.fetch = fetchMock;

    gb = buildGrowthBook();
    sessionReplayPlugin({ ingestorHost: INGESTOR_HOST, autoRecord: false })(gb);
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

  const fillBufferWithoutInteraction = async () => {
    emitEvent(SNAPSHOT_EVENT);
    for (let i = 0; i < 1000; i++) emitEvent(MUTATION_EVENT);
    await flushMicrotasks();
  };

  it("pauses instead of re-snapshotting when the buffer fills before any interaction", async () => {
    await fillBufferWithoutInteraction();

    expect(stopFns[0]).toHaveBeenCalledTimes(1);
    expect(mockRecord).toHaveBeenCalledTimes(1);

    // More page activity doesn't restart it
    jest.advanceTimersByTime(5 * 60 * 1000);
    expect(mockRecord).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pauses when non-snapshot bytes pass the cap, but not for a large snapshot", async () => {
    emitEvent(makeLargeEvent(3 * 1024 * 1024, 2));
    await flushMicrotasks();
    expect(stopFns[0]).not.toHaveBeenCalled();

    emitEvent(makeLargeEvent(1024 * 1024));
    emitEvent(makeLargeEvent(1024 * 1024));
    emitEvent(makeLargeEvent(1024 * 1024));
    await flushMicrotasks();
    expect(stopFns[0]).toHaveBeenCalledTimes(1);
  });

  it("restarts after the first interaction and ships the new recording", async () => {
    await fillBufferWithoutInteraction();

    document.dispatchEvent(new Event("pointerdown"));
    // Restart happens in idle time, not inside the input handler
    expect(mockRecord).toHaveBeenCalledTimes(1);
    jest.runOnlyPendingTimers();
    expect(mockRecord).toHaveBeenCalledTimes(2);

    // The restart counts the interaction rrweb missed, so the next periodic
    // flush ships without waiting for another one
    emitEvent(SNAPSHOT_EVENT);
    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      chunkIndex: number;
      events: Array<{ type: number }>;
    };
    expect(body.chunkIndex).toBe(0);
    expect(body.events[0].type).toBe(2);
  });

  it("a second interaction while restarting doesn't start twice", async () => {
    await fillBufferWithoutInteraction();
    document.dispatchEvent(new Event("pointerdown"));
    document.dispatchEvent(new Event("keydown"));
    jest.runOnlyPendingTimers();
    expect(mockRecord).toHaveBeenCalledTimes(2);
  });

  it("payload updates don't restart a paused recorder", async () => {
    await fillBufferWithoutInteraction();
    await gb.setPayload({});
    jest.runOnlyPendingTimers();
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  it("destroy removes the interaction listeners", async () => {
    await fillBufferWithoutInteraction();
    gb.destroy();
    document.dispatchEvent(new Event("pointerdown"));
    jest.runOnlyPendingTimers();
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  it("an interaction before the cap keeps the original recording going", async () => {
    emitEvent(SNAPSHOT_EVENT);
    emitEvent(INTERACTION_EVENT);
    for (let i = 0; i < 1500; i++) emitEvent(MUTATION_EVENT);
    await flushMicrotasks();
    expect(stopFns[0]).not.toHaveBeenCalled();
  });
});

describe("sessionReplayPlugin — startup and serialization cost", () => {
  let gb: GrowthBook;
  let emitEvent: (event: eventWithTime) => void;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    mockRecord.mockClear();
    seedSessionReplayId("f47ac10b-58cc-4372-a567-0e02b2c3d479");
    mockRecord.mockImplementation((options) => {
      emitEvent = (options as { emit: (e: eventWithTime) => void }).emit;
      return jest.fn();
    });
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    global.fetch = fetchMock;
    gb = buildGrowthBook();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete (global as unknown as Record<string, unknown>).fetch;
    gb.destroy();
    sessionStorage.clear();
    _resetSampleDecisionsForTests();
  });

  it("sets session_replay_id without re-rendering or re-running experiments", () => {
    const renderer = jest.fn();
    gb.setRenderer(renderer);
    const setAttributes = jest.spyOn(gb, "setAttributes");

    sessionReplayPlugin({ ingestorHost: INGESTOR_HOST, autoRecord: false })(gb);
    gb.startSessionReplay();

    expect(mockRecord).toHaveBeenCalledTimes(1);
    expect(gb.getAttributes().session_replay_id).toBe(
      "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    );
    // Other attributes survive the merge
    expect(gb.getAttributes().session_id).toBe("customer-session-id");
    expect(renderer).not.toHaveBeenCalled();
    expect(setAttributes).not.toHaveBeenCalled();
  });

  it("slims the snapshot of nodes the player never uses", () => {
    sessionReplayPlugin({ ingestorHost: INGESTOR_HOST, autoRecord: false })(gb);
    gb.startSessionReplay();
    expect(mockRecord.mock.calls[0][0]).toMatchObject({ slimDOMOptions: true });
  });

  it("serializes each rrweb event once, from emit through the request body", async () => {
    sessionReplayPlugin({ ingestorHost: INGESTOR_HOST, autoRecord: false })(gb);
    gb.startSessionReplay();

    const snapshot = {
      type: 2,
      timestamp: 1000,
      data: { node: { id: 1, childNodes: [] } },
    } as unknown as eventWithTime;
    const stringify = jest.spyOn(JSON, "stringify");

    emitEvent(snapshot);
    emitEvent(INTERACTION_EVENT);
    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(stringify.mock.calls.filter((c) => c[0] === snapshot).length).toBe(
      1,
    );
    stringify.mockRestore();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      events: unknown[];
      chunkIndex: number;
      clientKey: string;
    };
    expect(body.events).toEqual([snapshot, INTERACTION_EVENT]);
    expect(body.chunkIndex).toBe(0);
    expect(body.clientKey).toBe("sdk-test-key");
  });
});

describe("sessionReplayPlugin — duplicate registration", () => {
  let gb: GrowthBook;
  let emitters: Array<(event: eventWithTime) => void>;
  let stopFns: jest.Mock[];

  beforeEach(() => {
    jest.useFakeTimers();
    mockRecord.mockClear();
    seedSessionReplayId("f47ac10b-58cc-4372-a567-0e02b2c3d479");
    emitters = [];
    stopFns = [];

    mockRecord.mockImplementation((options) => {
      emitters.push((options as { emit: (e: eventWithTime) => void }).emit);
      const stop = jest.fn();
      stopFns.push(stop);
      return stop;
    });

    gb = buildGrowthBook();
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete (global as unknown as Record<string, unknown>).fetch;
    gb.destroy();
    sessionStorage.clear();
    _resetSampleDecisionsForTests();
  });

  // autoRecord + immediate so each plugin arms itself on apply — with
  // autoRecord off only the registered handler ever starts, which would mask
  // a second recorder entirely.
  const applyPlugin = () =>
    sessionReplayPlugin({
      ingestorHost: INGESTOR_HOST,
      autoRecord: true,
      startMode: "immediate",
    })(gb);

  it("stands the duplicate down so only one recorder runs", () => {
    applyPlugin();
    applyPlugin();

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("registered more than once"),
    );

    // Overwriting instead of rejecting would leave two live rrweb recorders
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  it("stopSessionReplay halts capture when registered twice", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    global.fetch = fetchMock;

    applyPlugin();
    applyPlugin();

    emitters[0](SNAPSHOT_EVENT);
    emitters[0](INTERACTION_EVENT);

    gb.stopSessionReplay();
    await flushMicrotasks();
    fetchMock.mockClear();

    // The orphaned recorder of the old behavior would keep emitting here
    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(stopFns[0]).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sessionReplayPlugin — chunk zero failure", () => {
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
    jest.spyOn(console, "error").mockImplementation(() => {});

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

  it("rotates to a new session instead of committing past a lost snapshot", async () => {
    // 400 is non-retriable, so chunk 0 is permanently rejected
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
    } as Response);
    global.fetch = fetchMock;

    emitEvent(SNAPSHOT_EVENT);
    emitEvent(INTERACTION_EVENT);

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    const body = JSON.parse(
      fetchMock.mock.calls[0][1].body as string,
    ) as Record<string, unknown>;
    expect(body.chunkIndex).toBe(0);

    // Nothing may be committed for a session whose snapshot never landed —
    // persisting it would make a reload resume at chunk 1 and cement it
    const persisted = sessionStorage.getItem("gb_session_replay");
    if (persisted) {
      const state = JSON.parse(persisted) as {
        sessionReplayId: string;
        lastChunkIndex: number;
      };
      expect(state.sessionReplayId).not.toBe(
        "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      );
    }

    // Rotation restarts rrweb, which emits a fresh FullSnapshot
    expect(mockRecord).toHaveBeenCalledTimes(2);
  });

  it("still skips a failed chunk past zero without rotating", async () => {
    let call = 0;
    const fetchMock = jest.fn().mockImplementation(() => {
      call++;
      return Promise.resolve({
        ok: call !== 2,
        status: call !== 2 ? 200 : 400,
        statusText: call !== 2 ? "OK" : "Bad Request",
      } as Response);
    });
    global.fetch = fetchMock;

    emitEvent(SNAPSHOT_EVENT);
    emitEvent(INTERACTION_EVENT);
    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    emitEvent(INTERACTION_EVENT);
    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    // Chunk 0 landed, so a later rejection skips rather than rotating
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  // Recovery is a technical rotation, not a new visit: re-rolling sampling on
  // the new id could land unsampled and silently end recording
  it("keeps recording through recovery when sampling would reject the new id", async () => {
    gb.destroy();
    sessionStorage.clear();
    _resetSampleDecisionsForTests();
    mockRecord.mockClear();
    seedSessionReplayId("f47ac10b-58cc-4372-a567-0e02b2c3d479");

    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
    } as Response);
    global.fetch = fetchMock;

    gb = buildGrowthBook();
    sessionReplayPlugin({
      ingestorHost: INGESTOR_HOST,
      autoRecord: false,
      samplingRate: 0,
    })(gb);
    // Forced start records despite rate 0; the rotation must not undo that
    gb.startSessionReplay();
    expect(mockRecord).toHaveBeenCalledTimes(1);

    emitEvent(SNAPSHOT_EVENT);
    emitEvent(INTERACTION_EVENT);
    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(mockRecord).toHaveBeenCalledTimes(2);
  });

  it("stops recovering after repeated chunk-0 rejections", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
    } as Response);
    global.fetch = fetchMock;

    // Each cycle flushes chunk 0, gets a 400, and rotates into a fresh
    // snapshot — more cycles than the recovery budget allows
    for (let i = 0; i < 6; i++) {
      emitEvent(SNAPSHOT_EVENT);
      emitEvent(INTERACTION_EVENT);
      jest.advanceTimersByTime(60_000);
      await flushMicrotasks();
    }

    // The initial start plus three budgeted recoveries, then it gives up
    expect(mockRecord).toHaveBeenCalledTimes(4);
  });

  it("carries interaction state across recovery so uploads resume", async () => {
    let failChunkZero = true;
    const fetchMock = jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: !failChunkZero,
        status: failChunkZero ? 400 : 200,
        statusText: failChunkZero ? "Bad Request" : "OK",
      } as Response),
    );
    global.fetch = fetchMock;

    emitEvent(SNAPSHOT_EVENT);
    emitEvent(INTERACTION_EVENT);
    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(mockRecord).toHaveBeenCalledTimes(2);
    failChunkZero = false;
    fetchMock.mockClear();

    // Only a snapshot — no new click. The pre-rotation interaction should
    // still count, or flushBuffer's hasUserInteraction guard blocks forever.
    emitEvent(SNAPSHOT_EVENT);
    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalled();
  });

  // cancel() only interrupts a back-off sleep, so a stop or destroy can land
  // while the chunk-0 fetch is still in flight
  const pendingFetch = () => {
    let settle: (r: Response) => void = () => undefined;
    const mock = jest.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          settle = resolve;
        }),
    );
    return {
      mock,
      reject400: () =>
        settle({
          ok: false,
          status: 400,
          statusText: "Bad Request",
        } as Response),
    };
  };

  it("does not restart when an explicit stop races a failing chunk 0", async () => {
    const { mock, reject400 } = pendingFetch();
    global.fetch = mock;

    emitEvent(SNAPSHOT_EVENT);
    emitEvent(INTERACTION_EVENT);
    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();
    expect(mock).toHaveBeenCalledTimes(1);

    gb.stopSessionReplay();
    reject400();
    await flushMicrotasks();

    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  it("ignores a stale chunk-0 failure from a superseded session", async () => {
    const { mock, reject400 } = pendingFetch();
    global.fetch = mock;

    emitEvent(SNAPSHOT_EVENT);
    emitEvent(INTERACTION_EVENT);
    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();
    expect(mock).toHaveBeenCalledTimes(1);

    // Session A's request is still open; the hard cap rotates us into B
    jest.advanceTimersByTime(31 * 60 * 1000);
    await flushMicrotasks();
    expect(mockRecord).toHaveBeenCalledTimes(2);

    // B is live and buffering
    emitEvent(SNAPSHOT_EVENT);
    emitEvent(INTERACTION_EVENT);

    // A finally fails — it must not clear B's buffers or rotate B into C
    reject400();
    await flushMicrotasks();

    expect(mockRecord).toHaveBeenCalledTimes(2);

    mock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    mock.mockClear();
    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    // B's buffered events survived
    const body = JSON.parse(mock.mock.calls[0][1].body as string) as {
      events: unknown[];
    };
    expect(body.events.length).toBeGreaterThan(0);
  });

  it("does not restart when destroy races a failing chunk 0", async () => {
    const { mock, reject400 } = pendingFetch();
    global.fetch = mock;

    emitEvent(SNAPSHOT_EVENT);
    emitEvent(INTERACTION_EVENT);
    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();
    expect(mock).toHaveBeenCalledTimes(1);

    gb.destroy();
    reject400();
    await flushMicrotasks();

    expect(mockRecord).toHaveBeenCalledTimes(1);
  });
});

describe("sessionReplayPlugin — non-DOM redaction", () => {
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

    gb = new GrowthBook({
      clientKey: "sdk-test-key",
      apiHost: "https://cdn.example.com",
      features: {},
      attributes: { id: "user-1", email: "person@example.com", plan: "pro" },
    });

    const plugin = sessionReplayPlugin({
      ingestorHost: INGESTOR_HOST,
      autoRecord: false,
      privacy: {
        redactAttributes: (attrs) => ({ ...attrs, email: "[redacted]" }),
        redactEventProperties: (eventName, props) =>
          eventName === "signup" ? { ...props, ssn: "[redacted]" } : props,
      },
    });
    plugin(gb);
    // Deliberately NOT started here: the pre-start window is what regressed
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete (global as unknown as Record<string, unknown>).fetch;
    gb.destroy();
    sessionStorage.clear();
    _resetSampleDecisionsForTests();
  });

  it("redacts attributes and event properties before they leave the browser", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    global.fetch = fetchMock;

    // Logged before startRecording, so resolvedPrivacy is still {} here.
    // Redaction has to happen at flush time for this to be scrubbed.
    gb.logEvent("signup", { ssn: "123-45-6789", tier: "gold" });

    gb.startSessionReplay();
    emitEvent(SNAPSHOT_EVENT);
    emitEvent(INTERACTION_EVENT);

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    const raw = fetchMock.mock.calls[0][1].body as string;
    const body = JSON.parse(raw) as {
      context: { attributes: string; device_id?: string };
      sessionEvents: { items: Array<{ properties?: Record<string, unknown> }> };
    };

    const attrs = JSON.parse(body.context.attributes) as Record<string, string>;
    expect(attrs.email).toBe("[redacted]");
    expect(attrs.plan).toBe("pro");

    // Ids route the replay, so they survive redaction of the attribute blob
    expect(body.context.device_id).toBe("user-1");

    const props = body.sessionEvents.items[0].properties;
    expect(props).toEqual({ ssn: "[redacted]", tier: "gold" });

    // Nothing sensitive anywhere in the serialized request
    expect(raw).not.toContain("person@example.com");
    expect(raw).not.toContain("123-45-6789");
  });

  // The flush keeps a separate redacted projection rather than writing back to
  // the live buffer, so a non-idempotent customer fn still runs exactly once
  it("applies the redactor exactly once per event", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    global.fetch = fetchMock;

    const ownGb = new GrowthBook({
      clientKey: "sdk-test-key",
      apiHost: "https://cdn.example.com",
      features: {},
      attributes: { id: "user-1" },
    });
    let calls = 0;
    sessionReplayPlugin({
      ingestorHost: INGESTOR_HOST,
      autoRecord: false,
      privacy: {
        // Non-idempotent on purpose: a second pass would append again
        redactEventProperties: (eventName, props) => {
          calls++;
          return { ...props, trail: `${props.trail ?? ""}x` };
        },
      },
    })(ownGb);

    ownGb.logEvent("signup", {});
    ownGb.startSessionReplay();
    emitEvent(SNAPSHOT_EVENT);
    emitEvent(INTERACTION_EVENT);

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      sessionEvents: { items: Array<{ properties?: Record<string, unknown> }> };
    };
    expect(calls).toBe(1);
    expect(body.sessionEvents.items[0].properties).toEqual({ trail: "x" });

    ownGb.destroy();
  });

  it("keeps chunk 0 buffered when a redactor throws", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    global.fetch = fetchMock;
    jest.spyOn(console, "error").mockImplementation(() => {});

    let shouldThrow = true;
    const ownGb = new GrowthBook({
      clientKey: "sdk-test-key",
      apiHost: "https://cdn.example.com",
      features: {},
      attributes: { id: "user-1" },
    });
    sessionReplayPlugin({
      ingestorHost: INGESTOR_HOST,
      autoRecord: false,
      privacy: {
        redactAttributes: (attrs) => {
          if (shouldThrow) throw new Error("redactor blew up");
          return attrs;
        },
      },
    })(ownGb);

    ownGb.startSessionReplay();
    emitEvent(SNAPSHOT_EVENT);
    emitEvent(INTERACTION_EVENT);

    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();
    expect(fetchMock).not.toHaveBeenCalled();

    // The snapshot has to survive the failed flush, or chunk 0 can never be
    // assembled and the session is lost for good
    shouldThrow = false;
    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      chunkIndex: number;
      events: Array<{ type: number }>;
    };
    expect(body.chunkIndex).toBe(0);
    expect(body.events.some((e) => e.type === 2)).toBe(true);

    ownGb.destroy();
  });
});
