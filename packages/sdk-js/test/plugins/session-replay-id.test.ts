import {
  getOrCreateSessionReplayId,
  SESSION_REPLAY_IDLE_TIMEOUT_MS,
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
});
