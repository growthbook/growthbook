import type { NextRouter } from "next/router";
import {
  createNavigationCancellation,
  interceptRouteChanges,
  isNavigationConfirmed,
  runConfirmedNavigation,
} from "./navigationCancellation";

function reject(reason: unknown) {
  const event = new Event("unhandledrejection", { cancelable: true });
  Object.defineProperty(event, "reason", { value: reason });
  window.dispatchEvent(event);
  return event;
}

describe("metric navigation cancellation", () => {
  it("suppresses reporting for repeated intentional cancellations", () => {
    const listener = vi.fn();
    window.addEventListener("unhandledrejection", listener);
    const cancellation = createNavigationCancellation();
    try {
      expect(cancellation.error.cancelled).toBe(true);
      expect(cancellation.error).not.toBeInstanceOf(Error);
      expect(reject(cancellation.error).defaultPrevented).toBe(true);
      expect(reject(cancellation.error).defaultPrevented).toBe(true);
      expect(listener).not.toHaveBeenCalled();
    } finally {
      cancellation.dispose();
      window.removeEventListener("unhandledrejection", listener);
    }
  });

  it("preserves unrelated errors and other cancellation signals", () => {
    const listener = vi.fn();
    const cancellation = createNavigationCancellation();
    window.addEventListener("unhandledrejection", listener);
    try {
      const otherError = Object.assign(
        new Error("Navigation cancelled to keep unsaved metric changes"),
        {
          cancelled: true,
        },
      );
      expect(reject(otherError).defaultPrevented).toBe(false);
      expect(reject({ cancelled: true }).defaultPrevented).toBe(false);
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      cancellation.dispose();
      window.removeEventListener("unhandledrejection", listener);
    }
  });

  it("removes the cancellation listener on cleanup", () => {
    const cancellation = createNavigationCancellation();
    cancellation.dispose();
    expect(reject(cancellation.error).defaultPrevented).toBe(false);
  });
});

describe("confirmed navigation", () => {
  it("is confirmed only while the navigation runs", async () => {
    let during = false;
    await runConfirmedNavigation(async () => {
      during = isNavigationConfirmed();
    });
    expect(during).toBe(true);
    expect(isNavigationConfirmed()).toBe(false);
  });

  it("clears the flag when the navigation fails", async () => {
    await expect(
      runConfirmedNavigation(() => Promise.reject(new Error("blocked"))),
    ).rejects.toThrow("blocked");
    expect(isNavigationConfirmed()).toBe(false);
  });
});

describe("interceptRouteChanges", () => {
  // Synchronous like Next's own emitter, so a thrown cancel reaches emit's caller.
  function fakeEvents() {
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    return {
      on: (type: string, h: (...args: unknown[]) => void) =>
        (handlers[type] ??= []).push(h),
      off: (type: string, h: (...args: unknown[]) => void) => {
        handlers[type] = (handlers[type] ?? []).filter((x) => x !== h);
      },
      emit: (type: string, ...args: unknown[]) =>
        handlers[type]?.forEach((h) => h(...args)),
    } as unknown as NextRouter["events"];
  }

  it("cancels claimed routes and lets the rest through", () => {
    const events = fakeEvents();
    const onError = vi.fn();
    events.on("routeChangeError", onError);
    const stop = interceptRouteChanges(events, (url) => url === "/away");
    expect(() => events.emit("routeChangeStart", "/stay")).not.toThrow();
    expect(() => events.emit("routeChangeStart", "/away")).toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    stop();
    expect(() => events.emit("routeChangeStart", "/away")).not.toThrow();
  });

  it("lets a confirmed navigation through", async () => {
    const events = fakeEvents();
    const intercept = vi.fn(() => true);
    const stop = interceptRouteChanges(events, intercept);
    await runConfirmedNavigation(async () => {
      events.emit("routeChangeStart", "/away");
    });
    expect(intercept).not.toHaveBeenCalled();
    stop();
  });
});
