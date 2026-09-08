import {
  getOrCreateGbSessionId,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_MAX_DURATION_MS,
  _resetGbSessionForTests,
} from "../../src/plugins/utils/gb-session";
import { setPolyfills } from "../../src/feature-repository";

const STORAGE_KEY = "gb_session";

function readStoredState(): {
  gb_session?: string;
  createdAt?: number;
  lastActiveAt?: number;
} {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as {
    gb_session?: string;
    createdAt?: number;
    lastActiveAt?: number;
  };
}

function writeStoredState(state: Record<string, unknown>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

describe("gb session manager", () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    _resetGbSessionForTests();
    jest.spyOn(Date, "now").mockReturnValue(1000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    localStorage.removeItem(STORAGE_KEY);
    _resetGbSessionForTests();
  });

  it("creates and stores a session id in localStorage", () => {
    const id = getOrCreateGbSessionId();
    const stored = readStoredState();

    expect(id).toEqual(expect.any(String));
    expect(stored).toEqual({
      gb_session: id,
      createdAt: 1000,
      lastActiveAt: 1000,
    });
  });

  it("reuses an existing session inside the idle window and refreshes it", () => {
    writeStoredState({
      gb_session: "existing-id",
      createdAt: 1000,
      lastActiveAt: 1000,
    });
    jest.spyOn(Date, "now").mockReturnValue(2000);

    const id = getOrCreateGbSessionId();

    expect(id).toBe("existing-id");
    expect(readStoredState()).toEqual({
      gb_session: "existing-id",
      createdAt: 1000,
      lastActiveAt: 2000,
    });
  });

  it("rotates after idleTimeout of inactivity", () => {
    writeStoredState({
      gb_session: "idle-id",
      createdAt: 1000,
      lastActiveAt: 1000,
    });
    jest.spyOn(Date, "now").mockReturnValue(1000 + DEFAULT_IDLE_TIMEOUT_MS + 1);

    const id = getOrCreateGbSessionId();

    expect(id).not.toBe("idle-id");
  });

  it("stays alive under continuous activity, up to the hard cap", () => {
    let now = 1000;
    jest.spyOn(Date, "now").mockImplementation(() => now);

    const id = getOrCreateGbSessionId();

    // Touch every 5 minutes — always inside the idle window
    const step = 5 * 60 * 1000;
    while (now - 1000 + step < DEFAULT_MAX_DURATION_MS) {
      now += step;
      expect(getOrCreateGbSessionId()).toBe(id);
    }

    // Next touch crosses the hard cap — rotates despite recent activity
    now = 1000 + DEFAULT_MAX_DURATION_MS + 1;
    expect(getOrCreateGbSessionId()).not.toBe(id);
  });

  it("rotates when forceNew is true", () => {
    writeStoredState({
      gb_session: "existing-id",
      createdAt: 1000,
      lastActiveAt: 1000,
    });

    const id = getOrCreateGbSessionId({ forceNew: true });

    expect(id).toEqual(expect.any(String));
    expect(id).not.toBe("existing-id");
    expect(readStoredState()).toEqual({
      gb_session: id,
      createdAt: 1000,
      lastActiveAt: 1000,
    });
  });

  it("respects custom idleTimeout and maxDuration", () => {
    const idleTimeout = 60 * 1000;
    writeStoredState({
      gb_session: "short-lived",
      createdAt: 1000,
      lastActiveAt: 1000,
    });

    // Within the custom idle window — reuse
    jest.spyOn(Date, "now").mockReturnValue(1000 + idleTimeout - 1);
    expect(getOrCreateGbSessionId({ idleTimeout })).toBe("short-lived");

    // Past the custom idle window — rotate
    jest.spyOn(Date, "now").mockReturnValue(1000 + 2 * idleTimeout);
    expect(getOrCreateGbSessionId({ idleTimeout })).not.toBe("short-lived");

    // Custom hard cap beats recent activity
    const maxDuration = 5 * 60 * 1000;
    writeStoredState({
      gb_session: "capped",
      createdAt: 1000,
      lastActiveAt: 1000 + maxDuration,
    });
    jest.spyOn(Date, "now").mockReturnValue(1000 + maxDuration + 1);
    expect(getOrCreateGbSessionId({ maxDuration })).not.toBe("capped");
  });

  it("replaces invalid stored state", () => {
    writeStoredState({ gb_session: "", createdAt: 1000 });

    const id = getOrCreateGbSessionId();

    expect(id).toEqual(expect.any(String));
    expect(id).not.toBe("");
    expect(readStoredState()).toEqual({
      gb_session: id,
      createdAt: 1000,
      lastActiveAt: 1000,
    });
  });

  it("uses polyfilled localStorage when set", () => {
    const store: Record<string, string> = {};
    setPolyfills({
      localStorage: {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
          store[key] = value;
        },
      },
    });

    const id = getOrCreateGbSessionId();

    expect(id).toEqual(expect.any(String));
    const stored = JSON.parse(store[STORAGE_KEY] || "{}");
    expect(stored).toEqual({
      gb_session: id,
      createdAt: 1000,
      lastActiveAt: 1000,
    });

    setPolyfills({ localStorage: globalThis.localStorage });
  });

  it("falls back to in-memory when no localStorage is available", () => {
    setPolyfills({
      localStorage: {
        getItem: () => {
          throw new Error("no storage");
        },
        setItem: () => {
          throw new Error("no storage");
        },
      },
    });

    const id = getOrCreateGbSessionId();
    expect(id).toEqual(expect.any(String));

    // Second call should return same id via in-memory fallback
    const id2 = getOrCreateGbSessionId();
    expect(id2).toBe(id);

    setPolyfills({ localStorage: globalThis.localStorage });
  });

  it("keeps a stable id when reads work but writes fail (quota)", () => {
    const store: Record<string, string> = {};
    setPolyfills({
      localStorage: {
        getItem: (key: string) => store[key] ?? null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
    });

    const id = getOrCreateGbSessionId();
    const id2 = getOrCreateGbSessionId();
    expect(id2).toBe(id);

    setPolyfills({ localStorage: globalThis.localStorage });
  });
});
