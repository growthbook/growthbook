import {
  getOrCreateGbSessionId,
  DEFAULT_MAX_DURATION_MS,
} from "../../src/plugins/gb-session";

const STORAGE_KEY = "gb_session";

function readStoredState(): {
  gbSessionId?: string;
  createdAt?: number;
} {
  return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}") as {
    gbSessionId?: string;
    createdAt?: number;
  };
}

describe("gb session manager", () => {
  beforeEach(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    jest.spyOn(Date, "now").mockReturnValue(1000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    sessionStorage.removeItem(STORAGE_KEY);
  });

  it("creates and stores a gbSessionId", () => {
    const id = getOrCreateGbSessionId();
    const stored = readStoredState();

    expect(id).toEqual(expect.any(String));
    expect(stored).toEqual({
      gbSessionId: id,
      createdAt: 1000,
    });
  });

  it("reuses an existing session within maxDuration", () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ gbSessionId: "existing-id", createdAt: 1000 }),
    );
    jest.spyOn(Date, "now").mockReturnValue(2000);

    const id = getOrCreateGbSessionId();

    expect(id).toBe("existing-id");
    // createdAt should NOT be bumped (no touch-on-read)
    expect(readStoredState().createdAt).toBe(1000);
  });

  it("rotates when forceNew is true", () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ gbSessionId: "existing-id", createdAt: 1000 }),
    );

    const id = getOrCreateGbSessionId({ forceNew: true });

    expect(id).toEqual(expect.any(String));
    expect(id).not.toBe("existing-id");
    expect(readStoredState()).toEqual({
      gbSessionId: id,
      createdAt: 1000,
    });
  });

  it("rotates when maxDuration has elapsed", () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ gbSessionId: "old-id", createdAt: 1000 }),
    );
    jest.spyOn(Date, "now").mockReturnValue(1000 + DEFAULT_MAX_DURATION_MS + 1);

    const id = getOrCreateGbSessionId();

    expect(id).toEqual(expect.any(String));
    expect(id).not.toBe("old-id");
    expect(readStoredState()).toEqual({
      gbSessionId: id,
      createdAt: 1000 + DEFAULT_MAX_DURATION_MS + 1,
    });
  });

  it("respects a custom maxDuration", () => {
    const customDuration = 5 * 60 * 1000; // 5 minutes
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ gbSessionId: "short-lived", createdAt: 1000 }),
    );

    // Within custom duration — should reuse
    jest.spyOn(Date, "now").mockReturnValue(1000 + customDuration - 1);
    expect(getOrCreateGbSessionId({ maxDuration: customDuration })).toBe(
      "short-lived",
    );

    // Past custom duration — should rotate
    jest.spyOn(Date, "now").mockReturnValue(1000 + customDuration + 1);
    const id = getOrCreateGbSessionId({ maxDuration: customDuration });
    expect(id).not.toBe("short-lived");
  });

  it("creates a new session when stored state has unrecognized format", () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ session_replay_id: "old-format", lastTouchedAt: 1000 }),
    );

    const id = getOrCreateGbSessionId();

    expect(id).toEqual(expect.any(String));
    expect(id).not.toBe("old-format");
  });

  it("replaces invalid stored state", () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ gbSessionId: "", createdAt: 1000 }),
    );

    const id = getOrCreateGbSessionId();

    expect(id).toEqual(expect.any(String));
    expect(id).not.toBe("");
    expect(readStoredState()).toEqual({
      gbSessionId: id,
      createdAt: 1000,
    });
  });
});
