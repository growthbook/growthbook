import type { eventWithTime } from "@rrweb/types";
import { record } from "rrweb";
import { GrowthBook } from "../../src";
import { sessionReplayPlugin } from "../../src/plugins/session-replay";

jest.mock("rrweb", () => ({ record: jest.fn() }));

// No-op stubs — privacy config and URL scrubbing have their own unit tests
jest.mock("../../src/plugins/session-replay-privacy", () => ({
  buildRrwebPrivacyOptions: () => ({}),
}));
jest.mock("../../src/plugins/session-replay-url-scrub", () => ({
  scrubEventUrls: (event: unknown) => event,
}));

const mockRecord = record as jest.MockedFunction<typeof record>;

// Capture real setTimeout before jest.useFakeTimers() replaces it.
// flushMicrotasks() uses it to wait until the entire microtask queue has
// drained without advancing the fake clock.
const realSetTimeout = global.setTimeout.bind(global);

/**
 * Schedules a macrotask via the real (unfaked) setTimeout. The JS event loop
 * drains the microtask queue completely before any macrotask fires, so
 * awaiting this guarantees every pending promise callback — including nested
 * chains — has settled before the test resumes.
 */
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

const TRACKING_HOST = "https://ingest.example.com";

function buildGrowthBook() {
  return new GrowthBook({
    clientKey: "sdk-test-key",
    apiHost: "https://cdn.example.com",
    attributes: {
      session_id: "customer-session-id",
      session_replay_id: "user-supplied-replay-id",
    },
  });
}

function seedSessionReplayId(sessionReplayId: string) {
  sessionStorage.setItem(
    "gb_session",
    JSON.stringify({
      session_replay_id: sessionReplayId,
      lastTouchedAt: Date.now(),
    }),
  );
}

// FLUSH_BYTE_SIZE in the plugin is 512 * 1024 = 524288
const FLUSH_BYTE_SIZE = 512 * 1024;

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
      trackingHost: TRACKING_HOST,
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
  });

  it("splits an oversized buffer into multiple fetch calls with incrementing chunkIndex", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    global.fetch = fetchMock;

    // Accumulate events before interaction — the pre-push size check
    // is gated on hasUserInteraction, so the buffer grows past
    // FLUSH_BYTE_SIZE without triggering a flush.
    emitEvent(SNAPSHOT_EVENT);
    emitEvent(makeLargeEvent(200_000));
    emitEvent(makeLargeEvent(200_000));
    emitEvent(makeLargeEvent(200_000));

    // Interaction event sets hasUserInteraction=true and triggers the
    // pre-push flush since bufferedBytes > FLUSH_BYTE_SIZE.
    emitEvent(INTERACTION_EVENT);
    await flushMicrotasks();

    // Snapshot isolated into chunk 0, then ~600KB of large events
    // partitioned into 2 more batches → 3 total
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

    // Large event before interaction so it accumulates
    emitEvent(SNAPSHOT_EVENT);
    emitEvent(makeLargeEvent(FLUSH_BYTE_SIZE + 100_000));

    emitEvent(INTERACTION_EVENT);
    await flushMicrotasks();

    // Snapshot goes in batch 0, oversized event goes in its own batch 1
    expect(fetchMock.mock.calls.length).toBe(2);

    const allEvents = fetchMock.mock.calls.flatMap((call) => {
      const body = JSON.parse(call[1].body as string) as {
        events: unknown[];
      };
      return body.events;
    });
    // snapshot + large event (interaction event lands in buffer after flush)
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

    // Snapshot chunk + 2 data chunks = 3
    expect(fetchMock.mock.calls.length).toBe(3);

    // First chunk (snapshot) carries metadata
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
      // Chunk 0: snapshot (OK)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
      } as Response)
      // Chunk 1: data batch (OK)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
      } as Response)
      // Chunk 2: data batch (413 — rejected)
      .mockResolvedValueOnce({
        ok: false,
        status: 413,
        statusText: "Payload Too Large",
      } as Response)
      // Chunk 3: data batch (OK)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
      } as Response);
    global.fetch = fetchMock;

    // 5 large events → snapshot chunk + 3 data batches after partitioning
    emitEvent(SNAPSHOT_EVENT);
    emitEvent(makeLargeEvent(200_000));
    emitEvent(makeLargeEvent(200_000));
    emitEvent(makeLargeEvent(200_000));
    emitEvent(makeLargeEvent(200_000));
    emitEvent(makeLargeEvent(200_000));

    emitEvent(INTERACTION_EVENT);
    await flushMicrotasks();

    // Snapshot chunk + 3 data chunks = 4 total; all attempted even
    // though one got 413
    expect(fetchMock.mock.calls.length).toBe(4);
  });

  it("keeps the full snapshot in the first batch (chunkIndex=0) even when preceded by smaller events", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response);
    global.fetch = fetchMock;

    // Meta event (type 4) is emitted by rrweb before the snapshot.
    // If the snapshot is large, naive partitioning could put the meta
    // in batch 0 and the snapshot in batch 1, failing the ingestor's
    // chunkIndex=0 must-have-snapshot validation.
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

    // chunkIndex=0 must contain a type-2 FullSnapshot
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
      trackingHost: TRACKING_HOST,
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
      `${TRACKING_HOST}/ingest/session-replay`,
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
      `${TRACKING_HOST}/ingest/session-replay`,
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
      sessionStorage.getItem("gb_session") || "{}",
    ) as { session_replay_id?: string };

    jest.advanceTimersByTime(31 * 60 * 1000);
    await flushMicrotasks();

    const rotatedStored = JSON.parse(
      sessionStorage.getItem("gb_session") || "{}",
    ) as { session_replay_id?: string };
    expect(rotatedStored.session_replay_id).toBeTruthy();
    expect(rotatedStored.session_replay_id).not.toBe(
      initialStored.session_replay_id,
    );
    expect(mockRecord).toHaveBeenCalledTimes(2);
  });
});
