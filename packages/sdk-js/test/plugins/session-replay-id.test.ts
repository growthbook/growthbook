import {
  getOrCreateSessionReplayId,
  SESSION_REPLAY_IDLE_TIMEOUT_MS,
  _resetSessionReplayIdForTests,
} from "../../src/plugins/session-replay/id";

const STORAGE_KEY = "gb_session_replay_id";

function readStoredState(): {
  gb_session_replay_id?: string;
  createdAt?: number;
  lastActiveAt?: number;
} {
  return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}") as {
    gb_session_replay_id?: string;
    createdAt?: number;
    lastActiveAt?: number;
  };
}

function writeStoredState(state: Record<string, unknown>) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

describe("session replay ID manager", () => {
  beforeEach(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    _resetSessionReplayIdForTests();
    jest.spyOn(Date, "now").mockReturnValue(1000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    sessionStorage.removeItem(STORAGE_KEY);
    _resetSessionReplayIdForTests();
  });

  it("creates and stores a replay id", () => {
    const sessionReplayId = getOrCreateSessionReplayId();
    const stored = readStoredState();

    expect(sessionReplayId).toEqual(expect.any(String));
    expect(stored).toEqual({
      gb_session_replay_id: sessionReplayId,
      createdAt: 1000,
      lastActiveAt: 1000,
    });
  });

  it("reuses and touches an existing replay id inside the idle window", () => {
    writeStoredState({
      gb_session_replay_id: "existing-replay-id",
      createdAt: 1000,
      lastActiveAt: 1000,
    });
    jest.spyOn(Date, "now").mockReturnValue(2000);

    const sessionReplayId = getOrCreateSessionReplayId();

    expect(sessionReplayId).toBe("existing-replay-id");
    expect(readStoredState()).toEqual({
      gb_session_replay_id: "existing-replay-id",
      createdAt: 1000,
      lastActiveAt: 2000,
    });
  });

  it("rotates when forceNew is true", () => {
    writeStoredState({
      gb_session_replay_id: "existing-replay-id",
      createdAt: 1000,
      lastActiveAt: 1000,
    });

    const sessionReplayId = getOrCreateSessionReplayId(true);

    expect(sessionReplayId).toEqual(expect.any(String));
    expect(sessionReplayId).not.toBe("existing-replay-id");
    expect(readStoredState()).toEqual({
      gb_session_replay_id: sessionReplayId,
      createdAt: 1000,
      lastActiveAt: 1000,
    });
  });

  it("rotates when the stored replay id is stale", () => {
    writeStoredState({
      gb_session_replay_id: "stale-replay-id",
      createdAt: 1000,
      lastActiveAt: 1000,
    });
    jest
      .spyOn(Date, "now")
      .mockReturnValue(1000 + SESSION_REPLAY_IDLE_TIMEOUT_MS + 1);

    const sessionReplayId = getOrCreateSessionReplayId();

    expect(sessionReplayId).toEqual(expect.any(String));
    expect(sessionReplayId).not.toBe("stale-replay-id");
    expect(readStoredState()).toEqual({
      gb_session_replay_id: sessionReplayId,
      createdAt: 1000 + SESSION_REPLAY_IDLE_TIMEOUT_MS + 1,
      lastActiveAt: 1000 + SESSION_REPLAY_IDLE_TIMEOUT_MS + 1,
    });
  });

  it("replaces invalid stored state", () => {
    writeStoredState({ gb_session_replay_id: "", lastActiveAt: 1000 });

    const sessionReplayId = getOrCreateSessionReplayId();

    expect(sessionReplayId).toEqual(expect.any(String));
    expect(sessionReplayId).not.toBe("");
    expect(readStoredState()).toEqual({
      gb_session_replay_id: sessionReplayId,
      createdAt: 1000,
      lastActiveAt: 1000,
    });
  });
});
