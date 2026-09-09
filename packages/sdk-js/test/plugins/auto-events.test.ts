import { GrowthBook } from "../../src";
import { createCWVReporter } from "../../src/plugins/auto-events/cwv-reporter";
import { createErrorReporter } from "../../src/plugins/auto-events/error-reporter";
import { createInteractionReporter } from "../../src/plugins/auto-events/interaction-reporter";
import { createEngagementReporter } from "../../src/plugins/auto-events/engagement-reporter";
import { createPageState } from "../../src/plugins/auto-events/page-state";
import {
  _resetUrlChangeObserverForTests,
  subscribeToUrlChanges,
} from "../../src/plugins/utils/url-change-observer";
import { autoEventsPlugin } from "../../src/plugins/auto-events";
import {
  _resetPrivacyForTests,
  sharePrivacySettings,
} from "../../src/plugins/utils/privacy";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Silence console noise unrelated to assertions.
let consoleErrorSpy: jest.SpyInstance;
let consoleWarnSpy: jest.SpyInstance;
beforeEach(() => {
  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
});

// Minimal PerformanceObserver mock that lets a test trigger entries on demand.
type ObserverInstance = {
  type: string;
  callback: (list: {
    getEntries: () => unknown[];
    getEntriesByName: (name: string) => unknown[];
  }) => void;
  disconnected: boolean;
  // entries observed but not yet delivered to the callback
  pending: unknown[];
};

const mockObservers: ObserverInstance[] = [];

class MockPerformanceObserver {
  private cb: ObserverInstance["callback"];
  private instance?: ObserverInstance;
  constructor(cb: ObserverInstance["callback"]) {
    this.cb = cb;
  }
  observe(opts: {
    type: string;
    buffered?: boolean;
    durationThreshold?: number;
  }) {
    this.instance = {
      type: opts.type,
      callback: this.cb,
      disconnected: false,
      pending: [],
    };
    mockObservers.push(this.instance);
  }
  disconnect() {
    if (this.instance) this.instance.disconnected = true;
  }
  takeRecords() {
    const records = this.instance?.pending ?? [];
    if (this.instance) this.instance.pending = [];
    return records;
  }
}

// Entries the browser has recorded but whose observer callback hasn't run yet
function queueEntries(type: string, entries: unknown[]) {
  for (const o of mockObservers) {
    if (o.type === type && !o.disconnected) o.pending.push(...entries);
  }
}

function emitEntries(type: string, entries: unknown[]) {
  for (const o of mockObservers) {
    if (o.type !== type || o.disconnected) continue;
    o.callback({
      getEntries: () => entries,
      getEntriesByName: (name: string) =>
        entries.filter((e) => (e as { name?: string }).name === name),
    });
  }
}

function setVisibilityState(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("CWV reporter", () => {
  let originalPO: typeof PerformanceObserver | undefined;
  let originalGetEntriesByType:
    | ((type: string) => PerformanceEntry[])
    | undefined;

  beforeEach(() => {
    mockObservers.length = 0;
    originalPO = (
      window as unknown as {
        PerformanceObserver?: typeof PerformanceObserver;
      }
    ).PerformanceObserver;
    (
      window as unknown as {
        PerformanceObserver: typeof PerformanceObserver;
      }
    ).PerformanceObserver =
      MockPerformanceObserver as unknown as typeof PerformanceObserver;

    originalGetEntriesByType = performance.getEntriesByType
      ? performance.getEntriesByType.bind(performance)
      : undefined;
    (
      performance as unknown as {
        getEntriesByType: (type: string) => PerformanceEntry[];
      }
    ).getEntriesByType = jest.fn(() => []) as () => PerformanceEntry[];

    _resetUrlChangeObserverForTests();
    setVisibilityState("visible");
  });

  afterEach(() => {
    if (originalPO) {
      (
        window as unknown as {
          PerformanceObserver: typeof PerformanceObserver;
        }
      ).PerformanceObserver = originalPO;
    } else {
      delete (window as unknown as { PerformanceObserver?: unknown })
        .PerformanceObserver;
    }
    if (originalGetEntriesByType) {
      (
        performance as unknown as {
          getEntriesByType: (type: string) => PerformanceEntry[];
        }
      ).getEntriesByType = originalGetEntriesByType;
    } else {
      delete (performance as unknown as { getEntriesByType?: unknown })
        .getEntriesByType;
    }
  });

  it("freezes LCP at the value seen before the first user interaction", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createCWVReporter({
      growthbook: gb,
      trackFCP: false,
      trackINP: false,
      trackCLS: false,
      trackTTFB: false,
      trackTBT: false,
    });

    emitEntries("largest-contentful-paint", [{ startTime: 1200 }]);
    // First user input — LCP should freeze here
    emitEntries("first-input", [{ startTime: 1500, processingStart: 1510 }]);
    // A later (larger) LCP entry must be ignored
    emitEntries("largest-contentful-paint", [{ startTime: 3000 }]);

    setVisibilityState("hidden");
    expect(logEvent).toHaveBeenCalledWith(
      "cwv_lcp",
      { value: 1200 },
      { url: expect.any(String) },
    );
    gb.destroy();
  });

  const inpOnly = {
    trackFCP: false,
    trackLCP: false,
    trackCLS: false,
    trackTTFB: false,
    trackTBT: false,
  };

  it("reports INP as the worst interaction, grouped by interactionId", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");
    createCWVReporter({ growthbook: gb, ...inpOnly });

    // One interaction emits several event-timing entries (pointerdown,
    // pointerup, click); the interaction's value is its worst entry
    emitEntries("event", [
      { interactionId: 1, duration: 80 },
      { interactionId: 1, duration: 200 },
      { interactionId: 2, duration: 150 },
    ]);

    setVisibilityState("hidden");
    expect(logEvent).toHaveBeenCalledWith(
      "cwv_inp",
      { value: 200 },
      { url: expect.any(String) },
    );
    gb.destroy();
  });

  it("ignores event-timing entries that aren't interactions and reports nothing without one", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");
    createCWVReporter({ growthbook: gb, ...inpOnly });

    // A slow mouseover handler has no interactionId — not an interaction
    emitEntries("event", [{ interactionId: 0, duration: 900 }]);

    setVisibilityState("hidden");
    expect(logEvent).not.toHaveBeenCalled();
    gb.destroy();
  });

  it("steps down from the worst interaction on pages with many interactions (p98 estimate)", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");
    createCWVReporter({ growthbook: gb, ...inpOnly });

    Object.defineProperty(performance, "interactionCount", {
      configurable: true,
      get: () => 120,
    });
    emitEntries("event", [
      { interactionId: 1, duration: 500 },
      { interactionId: 2, duration: 400 },
      { interactionId: 3, duration: 300 },
      { interactionId: 4, duration: 200 },
    ]);

    // 120 interactions → skip 2 candidates → third-worst
    setVisibilityState("hidden");
    expect(logEvent).toHaveBeenCalledWith(
      "cwv_inp",
      { value: 300 },
      { url: expect.any(String) },
    );
    delete (performance as unknown as { interactionCount?: number })
      .interactionCount;
    gb.destroy();
  });

  it("drains entries still queued in observers before finalizing", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");
    createCWVReporter({
      growthbook: gb,
      trackFCP: false,
      trackLCP: false,
      trackINP: false,
      trackTTFB: false,
      trackTBT: false,
    });

    emitEntries("layout-shift", [
      { startTime: 100, value: 0.1, hadRecentInput: false },
    ]);
    // The shift caused by the click that leaves the page hasn't been
    // delivered yet when visibility changes
    queueEntries("layout-shift", [
      { startTime: 200, value: 0.25, hadRecentInput: false },
    ]);

    setVisibilityState("hidden");
    expect(logEvent).toHaveBeenCalledWith(
      "cwv_cls",
      { value: 0.35 },
      { url: expect.any(String) },
    );
    gb.destroy();
  });

  it("finalizes on pagehide when visibilitychange never fires", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");
    createCWVReporter({
      growthbook: gb,
      trackFCP: false,
      trackLCP: false,
      trackINP: false,
      trackTTFB: false,
      trackTBT: false,
    });

    window.dispatchEvent(new Event("pagehide"));
    expect(logEvent).toHaveBeenCalledWith(
      "cwv_cls",
      { value: 0 },
      { url: expect.any(String) },
    );
    gb.destroy();
  });

  it("reports CLS as the largest session window, not cumulative-since-load", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createCWVReporter({
      growthbook: gb,
      trackFCP: false,
      trackLCP: false,
      trackINP: false,
      trackTTFB: false,
      trackTBT: false,
    });

    // First session: 0.1 + 0.2 = 0.3 within 5s
    emitEntries("layout-shift", [
      { startTime: 100, value: 0.1, hadRecentInput: false },
      { startTime: 600, value: 0.2, hadRecentInput: false },
    ]);
    // 2 second gap — starts a new session window
    emitEntries("layout-shift", [
      { startTime: 2700, value: 0.05, hadRecentInput: false },
    ]);
    // Third session, this one is the largest at 0.5
    emitEntries("layout-shift", [
      { startTime: 10000, value: 0.5, hadRecentInput: false },
    ]);
    // hadRecentInput entries are excluded entirely
    emitEntries("layout-shift", [
      { startTime: 10100, value: 0.9, hadRecentInput: true },
    ]);

    setVisibilityState("hidden");

    const clsCall = logEvent.mock.calls.find((c) => c[0] === "cwv_cls");
    expect(clsCall).toBeTruthy();
    expect((clsCall![1] as { value: number }).value).toBeCloseTo(0.5, 5);
    gb.destroy();
  });

  it("counts TBT even when long-task entries are received before FCP fires (fallback to getEntriesByName)", () => {
    const fcpEntry = {
      name: "first-contentful-paint",
      startTime: 250,
    } as unknown as PerformanceEntry;
    (
      performance as unknown as {
        getEntriesByName: (name: string) => PerformanceEntry[];
      }
    ).getEntriesByName = jest.fn((name: string) =>
      name === "first-contentful-paint" ? [fcpEntry] : [],
    );

    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    // Don't emit paint to the observer — simulate the longtask arriving
    // before the paint callback runs; the TBT path must fall back to
    // performance.getEntriesByName
    createCWVReporter({
      growthbook: gb,
      trackFCP: false,
      trackLCP: false,
      trackINP: false,
      trackCLS: false,
      trackTTFB: false,
    });

    emitEntries("longtask", [{ startTime: 400, duration: 120 }]);

    setVisibilityState("hidden");
    expect(logEvent).toHaveBeenCalledWith(
      "cwv_tbt",
      { value: 70 },
      { url: expect.any(String) },
    );
    gb.destroy();
  });

  it("only counts the post-FCP portion of long tasks toward TBT", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createCWVReporter({
      growthbook: gb,
      trackLCP: false,
      trackINP: false,
      trackCLS: false,
      trackTTFB: false,
    });

    // FCP at 250ms
    emitEntries("paint", [{ name: "first-contentful-paint", startTime: 250 }]);

    // Task A: 200..300 — overlaps FCP. Effective duration = 300-250 = 50ms.
    //   Blocking time = max(0, 50 - 50) = 0
    // Task B: 400..520 — entirely post-FCP. Effective duration = 120ms.
    //   Blocking time = 70
    // Task C: 100..200 — entirely pre-FCP. Should contribute 0.
    emitEntries("longtask", [
      { startTime: 200, duration: 100 },
      { startTime: 400, duration: 120 },
      { startTime: 100, duration: 100 },
    ]);

    setVisibilityState("hidden");
    expect(logEvent).toHaveBeenCalledWith(
      "cwv_tbt",
      { value: 70 },
      { url: expect.any(String) },
    );
    gb.destroy();
  });

  it("finalizing never mutates the SDK URL or dispatches growthbookrefresh", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");
    const setURL = jest.spyOn(gb, "setURL");
    const refreshHandler = jest.fn();
    document.addEventListener("growthbookrefresh", refreshHandler);

    createCWVReporter({
      growthbook: gb,
      trackFCP: false,
      trackLCP: false,
      trackINP: false,
      trackTTFB: false,
      trackTBT: false,
    });

    setVisibilityState("hidden");

    expect(logEvent).toHaveBeenCalled();
    expect(setURL).not.toHaveBeenCalled();
    expect(refreshHandler).not.toHaveBeenCalled();
    document.removeEventListener("growthbookrefresh", refreshHandler);
    gb.destroy();
  });

  it("suppresses FCP/LCP (but not CLS) for a page that loaded hidden", () => {
    setVisibilityState("hidden");
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");
    createCWVReporter({
      growthbook: gb,
      trackINP: false,
      trackTTFB: false,
      trackTBT: false,
    });

    // Background tab gets focused much later, then paints
    setVisibilityState("visible");
    emitEntries("paint", [
      { name: "first-contentful-paint", startTime: 90000 },
    ]);
    emitEntries("largest-contentful-paint", [{ startTime: 90500 }]);
    emitEntries("layout-shift", [
      { startTime: 91000, value: 0.2, hadRecentInput: false },
    ]);

    setVisibilityState("hidden");
    expect(logEvent).not.toHaveBeenCalledWith(
      "cwv_fcp",
      expect.anything(),
      expect.anything(),
    );
    expect(logEvent).not.toHaveBeenCalledWith(
      "cwv_lcp",
      expect.anything(),
      expect.anything(),
    );
    expect(logEvent).toHaveBeenCalledWith(
      "cwv_cls",
      { value: 0.2 },
      { url: expect.any(String) },
    );
    gb.destroy();
  });

  it("waits for prerender activation before observing", () => {
    Object.defineProperty(document, "prerendering", {
      configurable: true,
      get: () => true,
    });
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");
    createCWVReporter({
      growthbook: gb,
      trackFCP: false,
      trackLCP: false,
      trackINP: false,
      trackTTFB: false,
      trackTBT: false,
    });

    // Nothing observed yet — hidden during prerender must not finalize
    expect(mockObservers.length).toBe(0);
    setVisibilityState("hidden");
    expect(logEvent).not.toHaveBeenCalled();

    Object.defineProperty(document, "prerendering", {
      configurable: true,
      get: () => false,
    });
    setVisibilityState("visible");
    document.dispatchEvent(new Event("prerenderingchange"));
    expect(mockObservers.length).toBeGreaterThan(0);

    setVisibilityState("hidden");
    expect(logEvent).toHaveBeenCalledWith(
      "cwv_cls",
      { value: 0 },
      { url: expect.any(String) },
    );
    delete (document as unknown as { prerendering?: boolean }).prerendering;
    gb.destroy();
  });

  it("finalizes deferred metrics on SPA navigation without re-syncing the URL first", async () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");
    const setURL = jest.spyOn(gb, "setURL");

    createCWVReporter({
      growthbook: gb,
      trackFCP: false,
      trackLCP: false,
      trackINP: false,
      trackTTFB: false,
      trackTBT: false,
    });

    const pageUrl = window.location.href;
    window.history.pushState({}, "", "/cwv-next-page");
    await sleep(0);

    // Deferred metrics belong to the page that was just left: attributed to
    // its URL explicitly, and the GrowthBook URL is not synced beforehand
    expect(window.location.href).not.toBe(pageUrl);
    expect(logEvent).toHaveBeenCalledWith(
      "cwv_cls",
      { value: 0 },
      { url: pageUrl },
    );
    expect(setURL).not.toHaveBeenCalled();
    gb.destroy();
  });

  it("reports a CLS of zero (does not silently drop valid zero values)", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createCWVReporter({
      growthbook: gb,
      trackFCP: false,
      trackLCP: false,
      trackINP: false,
      trackTTFB: false,
      trackTBT: false,
    });
    setVisibilityState("hidden");

    expect(logEvent).toHaveBeenCalledWith(
      "cwv_cls",
      { value: 0 },
      { url: expect.any(String) },
    );
    gb.destroy();
  });

  it("reports a TBT of zero (does not silently drop valid zero values)", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createCWVReporter({
      growthbook: gb,
      trackFCP: false,
      trackLCP: false,
      trackINP: false,
      trackCLS: false,
      trackTTFB: false,
    });
    setVisibilityState("hidden");

    expect(logEvent).toHaveBeenCalledWith(
      "cwv_tbt",
      { value: 0 },
      { url: expect.any(String) },
    );
    gb.destroy();
  });

  it("does not report CWV when visibility goes from hidden to visible", () => {
    setVisibilityState("hidden");
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createCWVReporter({
      growthbook: gb,
      trackFCP: false,
      trackLCP: false,
      trackINP: false,
      trackCLS: true,
      trackTTFB: false,
      trackTBT: false,
    });

    setVisibilityState("visible");
    expect(logEvent).not.toHaveBeenCalled();

    setVisibilityState("hidden");
    expect(logEvent).toHaveBeenCalledWith("cwv_cls", expect.any(Object), {
      url: expect.any(String),
    });
    gb.destroy();
  });

  it("disconnects all observers when reporting and on destroy", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    createCWVReporter({ growthbook: gb });

    expect(mockObservers.length).toBeGreaterThan(0);
    gb.destroy();
    expect(mockObservers.every((o) => o.disconnected)).toBe(true);
  });
});

describe("Error reporter", () => {
  it("reports window errors with debounce and stack", async () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createErrorReporter({ growthbook: gb, debounceTimeout: 50 });

    const err = new Error("boom");
    const errorInit = {
      message: err.message,
      error: err,
      filename: "x.js",
      lineno: 1,
      colno: 2,
    };
    window.dispatchEvent(new ErrorEvent("error", errorInit));
    expect(logEvent).toHaveBeenCalledWith(
      "browser_error",
      expect.objectContaining({
        message: "boom",
        source: "x.js",
        lineno: 1,
        colno: 2,
      }),
    );

    // Same error within the debounce window is dropped
    window.dispatchEvent(new ErrorEvent("error", errorInit));
    expect(logEvent).toHaveBeenCalledTimes(1);

    await sleep(60);

    window.dispatchEvent(new ErrorEvent("error", errorInit));
    expect(logEvent).toHaveBeenCalledTimes(2);
    gb.destroy();
  });

  it("removes window listeners on destroy", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createErrorReporter({ growthbook: gb });
    gb.destroy();

    window.dispatchEvent(new ErrorEvent("error", { message: "after-destroy" }));
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("preserves the rejection value across non-Error reasons (string/number/object)", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createErrorReporter({ growthbook: gb, debounceTimeout: 0 });

    // PromiseRejectionEvent isn't always available in jsdom; the handler only
    // reads `event.reason`, so a regular Event with reason attached is enough
    const dispatch = (reason: unknown) => {
      const evt = new Event("unhandledrejection") as Event & {
        reason: unknown;
      };
      Object.defineProperty(evt, "reason", {
        configurable: true,
        get: () => reason,
      });
      window.dispatchEvent(evt);
    };

    // string rejection — Promise.reject("auth failed")
    dispatch("auth failed");
    expect(logEvent).toHaveBeenLastCalledWith(
      "browser_error",
      expect.objectContaining({ message: "auth failed", stack: "" }),
    );

    // number rejection
    dispatch(42);
    expect(logEvent).toHaveBeenLastCalledWith(
      "browser_error",
      expect.objectContaining({ message: "42" }),
    );

    // plain object without `.message` — described by shape, never serialized
    dispatch({ code: 500, error: "internal" });
    expect(logEvent).toHaveBeenLastCalledWith(
      "browser_error",
      expect.objectContaining({
        message: "Non-Error promise rejection captured with keys: code, error",
      }),
    );

    // plain object with `.message` and `.stack`
    dispatch({ message: "fetch failed", stack: "at line 1" });
    expect(logEvent).toHaveBeenLastCalledWith(
      "browser_error",
      expect.objectContaining({
        message: "fetch failed",
        stack: "at line 1",
      }),
    );

    // Error instance — message + stack preserved
    const err = new Error("boom");
    dispatch(err);
    expect(logEvent).toHaveBeenLastCalledWith(
      "browser_error",
      expect.objectContaining({ message: "boom", stack: err.stack }),
    );

    // null / undefined rejection — falls back to generic message
    dispatch(null);
    expect(logEvent).toHaveBeenLastCalledWith(
      "browser_error",
      expect.objectContaining({ message: "Unhandled Promise rejection" }),
    );

    gb.destroy();
  });

  it("counts only logged errors against the per-page budget", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");
    createErrorReporter({ growthbook: gb, debounceTimeout: 100 });

    // 500 rapid duplicates: one logged, the rest debounced — none consume budget
    for (let i = 0; i < 500; i++) {
      window.dispatchEvent(new ErrorEvent("error", { message: "same" }));
    }
    window.dispatchEvent(new ErrorEvent("error", { message: "different" }));

    const messages = logEvent.mock.calls.map(
      (c) => (c[1] as { message: string }).message,
    );
    expect(messages).toEqual(["same", "different"]);
    gb.destroy();
  });

  it("caps oversized error messages and stacks", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");
    createErrorReporter({ growthbook: gb, debounceTimeout: 0 });

    const err = new Error("x".repeat(5000));
    err.stack = "y".repeat(10000);
    window.dispatchEvent(
      new ErrorEvent("error", { error: err, message: err.message }),
    );

    const [, props] = logEvent.mock.calls[0];
    expect((props as { message: string }).message).toHaveLength(1000);
    expect((props as { stack: string }).stack).toHaveLength(4000);
    gb.destroy();
  });

  it("does not collapse cross-origin errors that share message + empty stack", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createErrorReporter({ growthbook: gb, debounceTimeout: 100 });

    // Two genuinely different cross-origin errors collapse to the same
    // (message, stack) pair without filename/lineno/colno in the key.
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "Script error.",
        filename: "https://cdn-a.example.com/a.js",
        lineno: 1,
        colno: 1,
      }),
    );
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "Script error.",
        filename: "https://cdn-b.example.com/b.js",
        lineno: 1,
        colno: 1,
      }),
    );

    expect(logEvent).toHaveBeenCalledTimes(2);

    // But truly identical errors still dedupe.
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "Script error.",
        filename: "https://cdn-a.example.com/a.js",
        lineno: 1,
        colno: 1,
      }),
    );
    expect(logEvent).toHaveBeenCalledTimes(2);

    gb.destroy();
  });
});

describe("subscribeToUrlChanges", () => {
  beforeEach(() => {
    _resetUrlChangeObserverForTests();
    window.history.replaceState({}, "", "/");
  });

  it("trackQueryString is per-subscriber and does not leak across subscribers", () => {
    const tracksQS = jest.fn();
    const ignoresQS = jest.fn();

    const unsubA = subscribeToUrlChanges(tracksQS, { trackQueryString: true });
    const unsubB = subscribeToUrlChanges(ignoresQS, {
      trackQueryString: false,
    });

    window.history.pushState({}, "", "/?filter=red");
    expect(tracksQS).toHaveBeenCalledTimes(1);
    expect(ignoresQS).toHaveBeenCalledTimes(0);

    window.history.pushState({}, "", "/?filter=blue");
    expect(tracksQS).toHaveBeenCalledTimes(2);
    expect(ignoresQS).toHaveBeenCalledTimes(0);

    // Pathname change fires both
    window.history.pushState({}, "", "/products");
    expect(tracksQS).toHaveBeenCalledTimes(3);
    expect(ignoresQS).toHaveBeenCalledTimes(1);

    unsubA();
    unsubB();
  });

  it("a CWV-style reporter is not finalized prematurely by an engagement reporter that opted into query-string tracking", async () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createCWVReporter({
      growthbook: gb,
      trackQueryStringChanges: false,
      trackFCP: false,
      trackLCP: false,
      trackINP: false,
      trackCLS: false,
      trackTTFB: false,
      trackTBT: false,
    });
    createEngagementReporter({
      growthbook: gb,
      samplingRate: 1,
      trackQueryStringChanges: true,
    });

    // Initial page_view
    expect(logEvent).toHaveBeenCalledWith(
      "page_view",
      {},
      { url: expect.any(String) },
    );
    logEvent.mockClear();

    window.history.pushState({}, "", "/?qs=1");
    await sleep(0);

    // engagement fires page_leave + page_view; CWV does not finalize
    const cwvCalls = logEvent.mock.calls.filter((c) =>
      String(c[0]).startsWith("cwv_"),
    );
    expect(cwvCalls.length).toBe(0);
    expect(logEvent).toHaveBeenCalledWith(
      "page_view",
      {},
      { url: expect.any(String) },
    );

    gb.destroy();
  });
});

describe("Interaction reporter", () => {
  beforeEach(() => {
    _resetPrivacyForTests();
    document.body.innerHTML = "";
  });

  it("tracks clicks on default selectors (links, buttons, data-gb-track)", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createInteractionReporter({ growthbook: gb, samplingRate: 1 });

    const btn = document.createElement("button");
    btn.textContent = "Go";
    document.body.appendChild(btn);
    btn.click();

    expect(logEvent).toHaveBeenCalledWith(
      "button_click",
      expect.objectContaining({ element_tag: "button" }),
    );

    document.body.removeChild(btn);
    gb.destroy();
  });

  it("skips gb-ignore elements and customer ignoreSelector, including rage clicks", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createInteractionReporter({
      growthbook: gb,
      samplingRate: 1,
      privacy: { ignoreSelector: ".skip-me" },
    });

    document.body.innerHTML = `
      <button class="skip-me">a</button>
      <div data-gb-ignore><button id="labeled">b</button></div>
      <form class="gb-ignore" name="secret"></form>
    `;
    for (const btn of Array.from(document.querySelectorAll("button"))) {
      for (let i = 0; i < 3; i++) {
        btn.dispatchEvent(
          new MouseEvent("click", { bubbles: true, clientX: 1, clientY: 1 }),
        );
      }
    }
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(logEvent).not.toHaveBeenCalled();
    gb.destroy();
  });

  it("redacts text, data attributes, and href ids under gb-mask/gb-block, with gb-allow as the escape", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createInteractionReporter({
      growthbook: gb,
      samplingRate: 1,
      privacy: { maskTextSelector: ".pii" },
    });

    document.body.innerHTML = `
      <div data-gb-mask data-gb-plan="pro">
        <a id="masked" href="/users/123/orders?token=x" data-gb-cta="buy">Jane Doe</a>
        <span class="gb-allow"><button id="allowed" data-gb-cta="ok">Visible</button></span>
      </div>
      <div class="gb-block"><button id="blocked">Card 4242</button></div>
      <button id="custom" class="pii">SSN</button>
      <button id="plain" data-gb-cta="go">Plain</button>
    `;
    for (const id of ["masked", "allowed", "blocked", "custom", "plain"]) {
      document.getElementById(id)!.click();
    }

    const props = (id: string) =>
      logEvent.mock.calls.find((c) => c[1]?.element_id === id)?.[1] ?? {};

    expect(props("masked")).toEqual(
      expect.objectContaining({
        element_href: "http://localhost/users/[id]/orders",
        element_href_path: "/users/[id]/orders",
      }),
    );
    expect(props("masked")).not.toHaveProperty("element_text");
    expect(props("masked")).not.toHaveProperty("data_cta");
    expect(props("masked")).not.toHaveProperty("data_plan");
    expect(props("allowed")).toEqual(
      expect.objectContaining({ element_text: "Visible", data_cta: "ok" }),
    );
    const blocked = logEvent.mock.calls.find(
      (c) => c[0] === "button_click" && c[1] && !("element_id" in c[1]),
    );
    expect(blocked && blocked[1]).toEqual({
      element_tag: "button",
      x: 0,
      y: 0,
    });
    expect(props("custom")).not.toHaveProperty("element_text");
    expect(props("plain")).toEqual(
      expect.objectContaining({ element_text: "Plain", data_cta: "go" }),
    );
    expect(props("plain")).not.toHaveProperty("data_mask");
    gb.destroy();
  });

  it("describes rage clicks on untracked elements without their text", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createInteractionReporter({ growthbook: gb, samplingRate: 1 });

    document.body.innerHTML = `<p id="addr">jane.doe@acme.com, 12 Elm St</p>`;
    const p = document.getElementById("addr")!;
    for (let i = 0; i < 3; i++) {
      p.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 5, clientY: 5 }),
      );
    }

    expect(logEvent).toHaveBeenCalledTimes(1);
    const [name, props] = logEvent.mock.calls[0];
    expect(name).toBe("rage_click");
    expect(props).toEqual(expect.objectContaining({ element_tag: "p" }));
    expect(props).not.toHaveProperty("element_text");
    gb.destroy();
  });

  it("inherits privacy settings another plugin registered, even after it started", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createInteractionReporter({ growthbook: gb, samplingRate: 1 });
    sharePrivacySettings({ ignoreSelector: ".from-replay" });

    document.body.innerHTML = `<button class="from-replay">x</button>`;
    document.querySelector("button")!.click();

    expect(logEvent).not.toHaveBeenCalled();
    gb.destroy();
  });

  it("detects custom event name via data-gb-track", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createInteractionReporter({ growthbook: gb, samplingRate: 1 });

    const div = document.createElement("div");
    div.setAttribute("data-gb-track", "cta_hero");
    document.body.appendChild(div);
    div.click();

    expect(logEvent).toHaveBeenCalledWith(
      "cta_hero",
      expect.objectContaining({ element_tag: "div" }),
    );

    document.body.removeChild(div);
    gb.destroy();
  });

  it("tracks form submissions", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createInteractionReporter({ growthbook: gb, samplingRate: 1 });

    const form = document.createElement("form");
    form.setAttribute("name", "signup");
    document.body.appendChild(form);

    const submitEvent = new Event("submit", {
      bubbles: true,
      cancelable: true,
    });
    form.dispatchEvent(submitEvent);

    expect(logEvent).toHaveBeenCalledWith(
      "form_submit",
      expect.objectContaining({ form_name: "signup" }),
    );

    document.body.removeChild(form);
    gb.destroy();
  });

  it("fires rage_click when threshold is met within time + distance window", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createInteractionReporter({
      growthbook: gb,
      samplingRate: 1,
    });

    const btn = document.createElement("button");
    document.body.appendChild(btn);

    for (let i = 0; i < 3; i++) {
      const evt = new MouseEvent("click", {
        bubbles: true,
        clientX: 10,
        clientY: 10,
      });
      btn.dispatchEvent(evt);
    }

    expect(logEvent).toHaveBeenCalledWith(
      "rage_click",
      expect.objectContaining({ click_count: 3 }),
    );

    document.body.removeChild(btn);
    gb.destroy();
  });

  it("cleans up listeners on destroy", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createInteractionReporter({ growthbook: gb, samplingRate: 1 });
    gb.destroy();

    const btn = document.createElement("button");
    document.body.appendChild(btn);
    btn.click();

    expect(logEvent).not.toHaveBeenCalled();
    document.body.removeChild(btn);
  });
});

describe("Engagement reporter", () => {
  beforeEach(() => {
    _resetUrlChangeObserverForTests();
    window.history.replaceState({}, "", "/");
    setVisibilityState("visible");
  });

  it("fires initial page_view for sampled users", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createEngagementReporter({
      growthbook: gb,
      samplingRate: 1,
    });

    expect(logEvent).toHaveBeenCalledWith(
      "page_view",
      {},
      { url: expect.any(String) },
    );
    gb.destroy();
  });

  it("emits nothing when sampled out", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createEngagementReporter({
      growthbook: gb,
      samplingRate: 0,
      heartbeats: true,
    });

    expect(logEvent).not.toHaveBeenCalledWith(
      "page_view",
      expect.anything(),
      expect.anything(),
    );
    gb.destroy();
  });

  it("fires page_leave on pagehide", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createEngagementReporter({
      growthbook: gb,
      samplingRate: 1,
      heartbeats: true,
    });

    window.dispatchEvent(new Event("pagehide"));

    expect(logEvent).toHaveBeenCalledWith(
      "page_leave",
      expect.objectContaining({
        leave_reason: "pagehide",
      }),
      { url: expect.any(String) },
    );
    gb.destroy();
  });

  it("attributes page_leave to the page left and page_view to the new page without touching the SDK URL", async () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");
    const setURL = jest.spyOn(gb, "setURL");
    createEngagementReporter({
      growthbook: gb,
      samplingRate: 1,
      heartbeats: true,
    });
    const firstUrl = window.location.href;
    logEvent.mockClear();

    window.history.pushState({}, "", "/second");
    await sleep(0);

    expect(logEvent).toHaveBeenCalledWith(
      "page_leave",
      expect.objectContaining({ leave_reason: "route_change" }),
      { url: firstUrl },
    );
    expect(logEvent).toHaveBeenCalledWith(
      "page_view",
      {},
      { url: window.location.href },
    );
    expect(window.location.href).not.toBe(firstUrl);
    expect(setURL).not.toHaveBeenCalled();
    gb.destroy();
  });

  it("keeps page state per instance so two live instances each emit page_leave", () => {
    const gb1 = new GrowthBook({ clientKey: "one" });
    const gb2 = new GrowthBook({ clientKey: "two" });
    const log1 = jest.spyOn(gb1, "logEvent");
    const log2 = jest.spyOn(gb2, "logEvent");
    for (const gb of [gb1, gb2]) {
      createEngagementReporter({
        growthbook: gb,
        samplingRate: 1,
        heartbeats: true,
      });
    }

    window.dispatchEvent(new Event("pagehide"));
    expect(log1.mock.calls.filter((c) => c[0] === "page_leave")).toHaveLength(
      1,
    );
    expect(log2.mock.calls.filter((c) => c[0] === "page_leave")).toHaveLength(
      1,
    );
    gb1.destroy();
    gb2.destroy();
  });

  it("strips the URL fragment from event attribution", () => {
    window.history.replaceState(
      {},
      "",
      "/callback?code=abc#access_token=secret",
    );
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");
    createEngagementReporter({
      growthbook: gb,
      samplingRate: 1,
    });

    expect(logEvent).toHaveBeenCalledWith(
      "page_view",
      {},
      { url: "http://localhost/callback?code=abc" },
    );
    gb.destroy();
  });

  it("reports max_scroll_depth_percent as 100 for a page that fits the viewport", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");
    createEngagementReporter({
      growthbook: gb,
      samplingRate: 1,
      heartbeats: true,
    });

    window.dispatchEvent(new Event("pagehide"));
    expect(logEvent).toHaveBeenCalledWith(
      "page_leave",
      expect.objectContaining({ max_scroll_depth_percent: 100 }),
      { url: expect.any(String) },
    );
    gb.destroy();
  });

  it("omits click/form counters from page_leave unless the interaction reporter is running", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");
    createEngagementReporter({
      growthbook: gb,
      samplingRate: 1,
      heartbeats: true,
    });

    window.dispatchEvent(new Event("pagehide"));
    const [, props] = logEvent.mock.calls.find((c) => c[0] === "page_leave")!;
    expect(props).not.toHaveProperty("click_count");
    expect(props).not.toHaveProperty("is_bounce_candidate");
    gb.destroy();

    const gb2 = new GrowthBook({ clientKey: "test" });
    const logEvent2 = jest.spyOn(gb2, "logEvent");
    const pageState = createPageState();
    createInteractionReporter({ growthbook: gb2, samplingRate: 1, pageState });
    createEngagementReporter({
      growthbook: gb2,
      samplingRate: 1,
      heartbeats: true,
      pageState,
    });
    window.dispatchEvent(new Event("pagehide"));
    const [, props2] = logEvent2.mock.calls.find((c) => c[0] === "page_leave")!;
    expect(props2).toMatchObject({ click_count: 0, is_bounce_candidate: true });
    gb2.destroy();
  });

  it("sends page_engagement on visibilitychange to hidden", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createEngagementReporter({
      growthbook: gb,
      samplingRate: 1,
      heartbeats: true,
    });

    setVisibilityState("hidden");

    expect(logEvent).toHaveBeenCalledWith(
      "page_engagement",
      expect.objectContaining({ visibility_state: "hidden" }),
      { url: expect.any(String) },
    );
    gb.destroy();
  });

  it("fires page_view + page_leave on SPA navigation", async () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createEngagementReporter({
      growthbook: gb,
      samplingRate: 1,
      heartbeats: true,
    });

    expect(logEvent).toHaveBeenCalledWith(
      "page_view",
      {},
      { url: expect.any(String) },
    );
    logEvent.mockClear();

    window.history.pushState({}, "", "/new-page");
    await sleep(0);

    expect(logEvent).toHaveBeenCalledWith(
      "page_leave",
      expect.objectContaining({ leave_reason: "route_change" }),
      { url: expect.any(String) },
    );
    expect(logEvent).toHaveBeenCalledWith(
      "page_view",
      {},
      { url: expect.any(String) },
    );
    gb.destroy();
  });

  it("sends heartbeats up to maxHeartbeats", () => {
    jest.useFakeTimers();
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createEngagementReporter({
      growthbook: gb,
      samplingRate: 1,
      heartbeats: true,
      heartbeatIntervalMs: 1000,
      maxHeartbeats: 2,
    });

    jest.advanceTimersByTime(3500);

    const heartbeats = logEvent.mock.calls.filter(
      (c) =>
        c[0] === "page_engagement" &&
        (c[1] as Record<string, unknown>).heartbeat_index,
    );
    expect(heartbeats.length).toBe(2);

    gb.destroy();
    jest.useRealTimers();
  });

  it("cleans up on destroy", () => {
    jest.useFakeTimers();
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createEngagementReporter({
      growthbook: gb,
      samplingRate: 1,
      heartbeats: true,
      heartbeatIntervalMs: 1000,
    });

    logEvent.mockClear();
    gb.destroy();

    jest.advanceTimersByTime(5000);
    expect(logEvent).not.toHaveBeenCalled();

    jest.useRealTimers();
  });
});

describe("autoEventsPlugin", () => {
  beforeEach(() => {
    _resetUrlChangeObserverForTests();
    window.history.replaceState({}, "", "/");
  });

  it("is SSR-safe (returns a function without throwing)", () => {
    expect(() => autoEventsPlugin({ cwv: true })).not.toThrow();
  });

  it("falls back to the default rate with a warning instead of throwing on bad config", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const gb = new GrowthBook({ clientKey: "test" });
    expect(() =>
      autoEventsPlugin({ cwv: { samplingRate: 15 } })(gb),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("cwv.samplingRate must be between 0 and 1"),
    );
    warn.mockRestore();
    gb.destroy();
  });

  it("categories are off until local settings or remote sdkSettings turn them on", async () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");
    autoEventsPlugin()(gb);
    const btn = document.createElement("button");
    document.body.appendChild(btn);

    btn.click();
    expect(logEvent).not.toHaveBeenCalled();

    await gb.setPayload({
      sdkSettings: {
        autoEvents: { clickstream: { enabled: true, samplingRate: 1 } },
      },
    });
    btn.click();
    expect(logEvent).toHaveBeenCalledWith("button_click", expect.any(Object));

    logEvent.mockClear();
    await gb.setPayload({
      sdkSettings: { autoEvents: { clickstream: { enabled: false } } },
    });
    btn.click();
    expect(logEvent).not.toHaveBeenCalled();

    document.body.removeChild(btn);
    gb.destroy();
  });

  it("a local false stays off when remote enables the category", async () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");
    autoEventsPlugin({ clickstream: false })(gb);
    await gb.setPayload({
      sdkSettings: {
        autoEvents: { clickstream: { enabled: true, samplingRate: 1 } },
      },
    });

    const btn = document.createElement("button");
    document.body.appendChild(btn);
    btn.click();
    expect(logEvent).not.toHaveBeenCalled();

    document.body.removeChild(btn);
    gb.destroy();
  });

  it("a remote samplingRate overrides the local one and restarts the category", async () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");
    autoEventsPlugin({ clickstream: { samplingRate: 0 } })(gb);
    const btn = document.createElement("button");
    document.body.appendChild(btn);

    btn.click();
    expect(logEvent).not.toHaveBeenCalled();

    await gb.setPayload({
      sdkSettings: { autoEvents: { clickstream: { samplingRate: 1 } } },
    });
    btn.click();
    expect(logEvent).toHaveBeenCalledWith("button_click", expect.any(Object));

    document.body.removeChild(btn);
    gb.destroy();
  });

  it("a plugin that throws during init fails the GrowthBook constructor loudly", () => {
    expect(
      () =>
        new GrowthBook({
          clientKey: "test",
          plugins: [
            () => {
              throw new Error("misconfigured plugin");
            },
          ],
        }),
    ).toThrow("misconfigured plugin");
  });

  it("wires up interaction + engagement reporters when rates > 0", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    const apply = autoEventsPlugin({
      cwv: false,
      errors: false,
      pageEvents: { samplingRate: 1, heartbeats: true },
      clickstream: { samplingRate: 1 },
    });
    apply(gb);

    expect(logEvent).toHaveBeenCalledWith(
      "page_view",
      {},
      { url: expect.any(String) },
    );

    const btn = document.createElement("button");
    document.body.appendChild(btn);
    btn.click();
    expect(logEvent).toHaveBeenCalledWith(
      "button_click",
      expect.objectContaining({ element_tag: "button" }),
    );

    document.body.removeChild(btn);
    gb.destroy();
  });

  it("warns when given a non-GrowthBook instance and a browser-only category is enabled", () => {
    const fakeClient = { logEvent: jest.fn(), getDecryptedPayload: () => ({}) };
    const apply = autoEventsPlugin({
      cwv: false,
      pageEvents: false,
      clickstream: true,
    });
    apply(fakeClient as never);

    const warns = consoleWarnSpy.mock.calls.map((c) => String(c[0]));
    expect(
      warns.some((m) => m.includes("clickstream need a GrowthBook instance")),
    ).toBe(true);
  });
});

describe("GrowthBook event buffer", () => {
  it("buffers events logged before setEventLogger is called and flushes them", async () => {
    const gb = new GrowthBook({ clientKey: "test" });

    // No logger registered yet
    await gb.logEvent("evt-1", { a: 1 });
    await gb.logEvent("evt-2", { b: 2 });

    // A warning was emitted (only once)
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);

    const logger = jest.fn((..._args: unknown[]) => Promise.resolve());
    gb.setEventLogger(logger as never);

    // Yield for async flush to complete
    await sleep(0);

    expect(logger).toHaveBeenCalledTimes(2);
    expect(logger.mock.calls[0]?.[0]).toBe("evt-1");
    expect(logger.mock.calls[1]?.[0]).toBe("evt-2");
    gb.destroy();
  });

  it("does not re-run devtools/subscriber hooks when flushing the buffer", async () => {
    const gb = new GrowthBook({ clientKey: "test", enableDevMode: true });
    const sub = jest.fn();
    gb._subscribeCustomEvents(sub);
    await gb.logEvent("buffered", { a: 1 });
    expect(
      gb.logs.filter(
        (l) => l.logType === "event" && l.eventName === "buffered",
      ),
    ).toHaveLength(1);
    expect(sub).toHaveBeenCalledTimes(1);

    const logger = jest.fn();
    gb.setEventLogger(logger);
    await sleep(0);
    expect(logger).toHaveBeenCalledTimes(1);
    expect(
      gb.logs.filter(
        (l) => l.logType === "event" && l.eventName === "buffered",
      ),
    ).toHaveLength(1);
    expect(sub).toHaveBeenCalledTimes(1);
    gb.destroy();
  });

  it("caps the buffer at 100 events", async () => {
    const gb = new GrowthBook({ clientKey: "test" });

    for (let i = 0; i < 150; i++) {
      await gb.logEvent("evt", { i });
    }

    const logger = jest.fn((..._args: unknown[]) => Promise.resolve());
    gb.setEventLogger(logger as never);
    await sleep(0);

    expect(logger).toHaveBeenCalledTimes(100);
    // Oldest 50 dropped — first flushed event has i=50
    expect(logger.mock.calls[0]?.[1]).toEqual({ i: 50 });
    gb.destroy();
  });
});
