import {
  getOrCreateSessionReplayId,
  SESSION_REPLAY_IDLE_TIMEOUT_MS,
  touchSessionReplayId,
} from "../../src/plugins/session-replay-id";

const STORAGE_KEY = "gb_session";

function readStoredState(): {
  session_replay_id?: string;
  lastTouchedAt?: number;
} {
  return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}") as {
    session_replay_id?: string;
    lastTouchedAt?: number;
  };
}

describe("session replay ID manager", () => {
  beforeEach(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    jest.spyOn(Date, "now").mockReturnValue(1000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    getOrCreateSessionReplayId(true);
    sessionStorage.removeItem(STORAGE_KEY);
  });

  it("creates and stores a session_replay_id", () => {
    const sessionReplayId = getOrCreateSessionReplayId();
    const stored = readStoredState();

    expect(sessionReplayId).toEqual(expect.any(String));
    expect(stored).toEqual({
      session_replay_id: sessionReplayId,
      lastTouchedAt: 1000,
    });
  });

  it("reuses and touches an existing session_replay_id inside the idle window", () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        session_replay_id: "existing-replay-id",
        lastTouchedAt: 1000,
      }),
    );
    jest.spyOn(Date, "now").mockReturnValue(2000);

    const sessionReplayId = getOrCreateSessionReplayId();

    expect(sessionReplayId).toBe("existing-replay-id");
    expect(readStoredState()).toEqual({
      session_replay_id: "existing-replay-id",
      lastTouchedAt: 2000,
    });
  });

  it("rotates when forceNew is true", () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        session_replay_id: "existing-replay-id",
        lastTouchedAt: 1000,
      }),
    );

    const sessionReplayId = getOrCreateSessionReplayId(true);

    expect(sessionReplayId).toEqual(expect.any(String));
    expect(sessionReplayId).not.toBe("existing-replay-id");
    expect(readStoredState()).toEqual({
      session_replay_id: sessionReplayId,
      lastTouchedAt: 1000,
    });
  });

  it("rotates when the stored session_replay_id is stale", () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        session_replay_id: "stale-replay-id",
        lastTouchedAt: 1000,
      }),
    );
    jest
      .spyOn(Date, "now")
      .mockReturnValue(1000 + SESSION_REPLAY_IDLE_TIMEOUT_MS + 1);

    const sessionReplayId = getOrCreateSessionReplayId();

    expect(sessionReplayId).toEqual(expect.any(String));
    expect(sessionReplayId).not.toBe("stale-replay-id");
    expect(readStoredState()).toEqual({
      session_replay_id: sessionReplayId,
      lastTouchedAt: 1000 + SESSION_REPLAY_IDLE_TIMEOUT_MS + 1,
    });
  });

  it("migrates the legacy stored id field to session_replay_id", () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        id: "legacy-replay-id",
        lastTouchedAt: 1000,
      }),
    );
    jest.spyOn(Date, "now").mockReturnValue(2000);

    const sessionReplayId = getOrCreateSessionReplayId();

    expect(sessionReplayId).toBe("legacy-replay-id");
    expect(readStoredState()).toEqual({
      session_replay_id: "legacy-replay-id",
      lastTouchedAt: 2000,
    });
  });

  it("retains the in-memory fallback when sessionStorage writes fail", () => {
    const setItemSpy = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("QuotaExceededError");
      });

    const first = getOrCreateSessionReplayId();
    const second = getOrCreateSessionReplayId();

    expect(first).toBe(second);
    setItemSpy.mockRestore();
  });

  it("prefers a newer in-memory fallback over stale sessionStorage", () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        session_replay_id: "existing-replay-id",
        lastTouchedAt: 1000,
      }),
    );
    jest.spyOn(Date, "now").mockReturnValue(2000);
    const setItemSpy = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("QuotaExceededError");
      });

    const first = getOrCreateSessionReplayId();
    jest
      .spyOn(Date, "now")
      .mockReturnValue(1000 + SESSION_REPLAY_IDLE_TIMEOUT_MS + 1);
    const second = getOrCreateSessionReplayId();

    expect(first).toBe("existing-replay-id");
    expect(second).toBe(first);
    setItemSpy.mockRestore();
  });

  it("uses the in-memory fallback when stored state is invalid", () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        session_replay_id: "",
        lastTouchedAt: 1000,
      }),
    );
    const setItemSpy = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("QuotaExceededError");
      });

    const first = getOrCreateSessionReplayId();
    const second = getOrCreateSessionReplayId();

    expect(second).toBe(first);
    setItemSpy.mockRestore();
  });

  it("does not revive stale fallback after storage recovers and is cleared", () => {
    // Phase 1: writes fail, fallback is populated
    const setItemSpy = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("QuotaExceededError");
      });
    const staleId = getOrCreateSessionReplayId();
    setItemSpy.mockRestore();

    // Phase 2: storage recovers, new ID is persisted normally
    const recoveredId = getOrCreateSessionReplayId(true);
    expect(recoveredId).not.toBe(staleId);

    // Phase 3: storage is cleared within idle window
    sessionStorage.removeItem(STORAGE_KEY);
    const afterClear = getOrCreateSessionReplayId();

    // Should generate a fresh ID, not revive the stale one
    expect(afterClear).not.toBe(staleId);
  });

  it("replaces invalid stored state", () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        session_replay_id: "",
        lastTouchedAt: 1000,
      }),
    );

    const sessionReplayId = getOrCreateSessionReplayId();

    expect(sessionReplayId).toEqual(expect.any(String));
    expect(sessionReplayId).not.toBe("");
    expect(readStoredState()).toEqual({
      session_replay_id: sessionReplayId,
      lastTouchedAt: 1000,
    });
  });

  it("keeps an active session alive when touched", () => {
    const sessionReplayId = getOrCreateSessionReplayId();
    jest
      .spyOn(Date, "now")
      .mockReturnValue(1000 + SESSION_REPLAY_IDLE_TIMEOUT_MS - 1000);
    touchSessionReplayId();
    jest
      .spyOn(Date, "now")
      .mockReturnValue(1000 + SESSION_REPLAY_IDLE_TIMEOUT_MS + 1000);

    expect(getOrCreateSessionReplayId()).toBe(sessionReplayId);
  });

  it("does not revive an expired session when touched", () => {
    const sessionReplayId = getOrCreateSessionReplayId();
    jest
      .spyOn(Date, "now")
      .mockReturnValue(1000 + SESSION_REPLAY_IDLE_TIMEOUT_MS + 1);

    touchSessionReplayId();

    expect(getOrCreateSessionReplayId()).not.toBe(sessionReplayId);
  });
});
