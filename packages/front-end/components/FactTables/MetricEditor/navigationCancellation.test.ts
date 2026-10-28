import {
  createNavigationCancellation,
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
