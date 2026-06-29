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
