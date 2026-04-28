import { GrowthBook } from "../../src";
import { createCWVReporter } from "../../src/plugins/performance/cwvReporter";
import { createErrorReporter } from "../../src/plugins/performance/errorReporter";
import { createInteractionReporter } from "../../src/plugins/performance/interactionReporter";
import { createEngagementReporter } from "../../src/plugins/performance/engagementReporter";
import { _resetPageStateForTests } from "../../src/plugins/performance/pageState";
import {
  _resetUrlChangeObserverForTests,
  subscribeToUrlChanges,
} from "../../src/plugins/performance/urlChangeObserver";
import { browserEventsPlugin } from "../../src/plugins/performance/browser-events";

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
    };
    mockObservers.push(this.instance);
  }
  disconnect() {
    if (this.instance) this.instance.disconnected = true;
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

  it("reports FID as the input delay (processingStart - startTime), not the timestamp", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createCWVReporter({
      growthbook: gb,
      trackFID: true,
      trackFCP: false,
      trackLCP: false,
      trackINP: false,
      trackCLS: false,
      trackTTFB: false,
      trackTBT: false,
    });

    emitEntries("first-input", [{ startTime: 5000, processingStart: 5050 }]);

    expect(logEvent).toHaveBeenCalledWith("CWV:FID", { value: 50 });
    gb.destroy();
  });

  it("does not track FID by default (deprecated in favor of INP)", () => {
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

    emitEntries("first-input", [{ startTime: 5000, processingStart: 5050 }]);

    expect(logEvent).not.toHaveBeenCalledWith("CWV:FID", expect.anything());
    gb.destroy();
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
    expect(logEvent).toHaveBeenCalledWith("CWV:LCP", { value: 1200 });
    gb.destroy();
  });

  it("reports the worst INP from event timing entries", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createCWVReporter({
      growthbook: gb,
      trackFCP: false,
      trackLCP: false,
      trackCLS: false,
      trackTTFB: false,
      trackTBT: false,
    });

    emitEntries("event", [
      { duration: 80 },
      { duration: 200 },
      { duration: 150 },
    ]);

    setVisibilityState("hidden");
    expect(logEvent).toHaveBeenCalledWith("CWV:INP", { value: 200 });
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

    const clsCall = logEvent.mock.calls.find((c) => c[0] === "CWV:CLS");
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
    expect(logEvent).toHaveBeenCalledWith("CWV:TBT", { value: 70 });
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
    expect(logEvent).toHaveBeenCalledWith("CWV:TBT", { value: 70 });
    gb.destroy();
  });

  it("dispatches growthbookrefresh before logging deferred metrics", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");
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

    expect(refreshHandler).toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalled();
    document.removeEventListener("growthbookrefresh", refreshHandler);
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

    expect(logEvent).toHaveBeenCalledWith("CWV:CLS", { value: 0 });
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

    expect(logEvent).toHaveBeenCalledWith("CWV:TBT", { value: 0 });
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
    expect(logEvent).toHaveBeenCalledWith("CWV:CLS", expect.any(Object));
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
      "browser-error",
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
      "browser-error",
      expect.objectContaining({ message: "auth failed", stack: "" }),
    );

    // number rejection
    dispatch(42);
    expect(logEvent).toHaveBeenLastCalledWith(
      "browser-error",
      expect.objectContaining({ message: "42" }),
    );

    // plain object without `.message` — JSON-stringified
    dispatch({ code: 500, error: "internal" });
    expect(logEvent).toHaveBeenLastCalledWith(
      "browser-error",
      expect.objectContaining({
        message: JSON.stringify({ code: 500, error: "internal" }),
      }),
    );

    // plain object with `.message` and `.stack`
    dispatch({ message: "fetch failed", stack: "at line 1" });
    expect(logEvent).toHaveBeenLastCalledWith(
      "browser-error",
      expect.objectContaining({
        message: "fetch failed",
        stack: "at line 1",
      }),
    );

    // Error instance — message + stack preserved
    const err = new Error("boom");
    dispatch(err);
    expect(logEvent).toHaveBeenLastCalledWith(
      "browser-error",
      expect.objectContaining({ message: "boom", stack: err.stack }),
    );

    // null / undefined rejection — falls back to generic message
    dispatch(null);
    expect(logEvent).toHaveBeenLastCalledWith(
      "browser-error",
      expect.objectContaining({ message: "Unhandled Promise rejection" }),
    );

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
    // Regression test for the previous module-level trackQueryString flag
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
    _resetPageStateForTests();
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createCWVReporter({
      growthbook: gb,
      trackQueryStringChanges: false,
      trackFCP: false,
      trackLCP: false,
      trackFID: false,
      trackINP: false,
      trackCLS: false,
      trackTTFB: false,
      trackTBT: false,
    });
    createEngagementReporter({
      growthbook: gb,
      pageViewSamplingRate: 1,
      trackQueryStringChanges: true,
    });

    // Initial page_view
    expect(logEvent).toHaveBeenCalledWith("page_view");
    logEvent.mockClear();

    window.history.pushState({}, "", "/?qs=1");
    await sleep(0);

    // engagement fires page_leave + page_view; CWV does not finalize
    const cwvCalls = logEvent.mock.calls.filter((c) =>
      String(c[0]).startsWith("CWV:"),
    );
    expect(cwvCalls.length).toBe(0);
    expect(logEvent).toHaveBeenCalledWith("page_view");

    gb.destroy();
  });

  it("stops the polling timer once the last subscriber unsubscribes", () => {
    // jest will surface leaked timers; just need this to settle cleanly
    const cb = jest.fn();
    const unsub = subscribeToUrlChanges(cb, { enablePolling: true });
    unsub();
  });
});

describe("Interaction reporter", () => {
  beforeEach(() => {
    _resetPageStateForTests();
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

  it("respects ignoreClickSelector", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createInteractionReporter({
      growthbook: gb,
      samplingRate: 1,
      ignoreClickSelector: ".skip-me",
    });

    const btn = document.createElement("button");
    btn.className = "skip-me";
    document.body.appendChild(btn);
    btn.click();

    expect(logEvent).not.toHaveBeenCalled();

    document.body.removeChild(btn);
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
      rageThreshold: 3,
      rageTimeWindowMs: 5000,
      rageMaxDistancePx: 100,
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
    _resetPageStateForTests();
    window.history.replaceState({}, "", "/");
    setVisibilityState("visible");
  });

  it("fires initial page_view when pageViewSamplingRate > 0", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createEngagementReporter({
      growthbook: gb,
      pageViewSamplingRate: 1,
    });

    expect(logEvent).toHaveBeenCalledWith("page_view");
    gb.destroy();
  });

  it("does not fire page_view when pageViewSamplingRate is 0", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createEngagementReporter({
      growthbook: gb,
      pageViewSamplingRate: 0,
      engagementSamplingRate: 1,
    });

    expect(logEvent).not.toHaveBeenCalledWith("page_view");
    gb.destroy();
  });

  it("fires page_leave on pagehide", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createEngagementReporter({
      growthbook: gb,
      pageViewSamplingRate: 0,
      engagementSamplingRate: 1,
    });

    window.dispatchEvent(new Event("pagehide"));

    expect(logEvent).toHaveBeenCalledWith(
      "page_leave",
      expect.objectContaining({
        leave_reason: "pagehide",
      }),
    );
    gb.destroy();
  });

  it("sends page_engagement on visibilitychange to hidden", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createEngagementReporter({
      growthbook: gb,
      pageViewSamplingRate: 0,
      engagementSamplingRate: 1,
    });

    setVisibilityState("hidden");

    expect(logEvent).toHaveBeenCalledWith(
      "page_engagement",
      expect.objectContaining({ visibility_state: "hidden" }),
    );
    gb.destroy();
  });

  it("fires page_view + page_leave on SPA navigation", async () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createEngagementReporter({
      growthbook: gb,
      pageViewSamplingRate: 1,
      engagementSamplingRate: 1,
    });

    expect(logEvent).toHaveBeenCalledWith("page_view");
    logEvent.mockClear();

    window.history.pushState({}, "", "/new-page");
    await sleep(0);

    expect(logEvent).toHaveBeenCalledWith(
      "page_leave",
      expect.objectContaining({ leave_reason: "route_change" }),
    );
    expect(logEvent).toHaveBeenCalledWith("page_view");
    gb.destroy();
  });

  it("sends heartbeats up to maxHeartbeats", () => {
    jest.useFakeTimers();
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    createEngagementReporter({
      growthbook: gb,
      pageViewSamplingRate: 0,
      engagementSamplingRate: 1,
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
      pageViewSamplingRate: 1,
      engagementSamplingRate: 1,
      heartbeatIntervalMs: 1000,
    });

    logEvent.mockClear();
    gb.destroy();

    jest.advanceTimersByTime(5000);
    expect(logEvent).not.toHaveBeenCalled();

    jest.useRealTimers();
  });
});

describe("browserEventsPlugin", () => {
  beforeEach(() => {
    _resetUrlChangeObserverForTests();
    _resetPageStateForTests();
    window.history.replaceState({}, "", "/");
  });

  it("is SSR-safe (returns a function without throwing)", () => {
    expect(() => browserEventsPlugin({ cwvSamplingRate: 1 })).not.toThrow();
  });

  it("wires up interaction + engagement reporters when rates > 0", () => {
    const gb = new GrowthBook({ clientKey: "test" });
    const logEvent = jest.spyOn(gb, "logEvent");

    const apply = browserEventsPlugin({
      cwvSamplingRate: 0,
      errorSamplingRate: 0,
      pageViewSamplingRate: 1,
      engagementSamplingRate: 1,
      interactionSamplingRate: 1,
    });
    apply(gb);

    expect(logEvent).toHaveBeenCalledWith("page_view");

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

  it("warns when given a non-GrowthBook instance and engagement/interaction are enabled", () => {
    const fakeClient = { logEvent: jest.fn() };
    const apply = browserEventsPlugin({
      cwvSamplingRate: 0,
      errorSamplingRate: 1,
      interactionSamplingRate: 1,
    });
    apply(fakeClient as never);

    const warns = consoleWarnSpy.mock.calls.map((c) => String(c[0]));
    expect(
      warns.some((m) => m.includes("CWV / engagement / interaction")),
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
