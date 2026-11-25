export function detectEnv(): "browser" | "node" | "unknown" {
  if (typeof window !== "undefined" && typeof window.document !== "undefined")
    return "browser";
  if (
    typeof process !== "undefined" &&
    process.versions &&
    process.versions.node
  )
    return "node";
  return "unknown";
}

// The fragment is never useful for attribution and often carries OAuth tokens
export function currentPageUrl(): string {
  const { origin, pathname, search } = window.location;
  return origin + pathname + search;
}

// Prerendered pages (speculation rules) run scripts before the user sees
// anything; observability must wait for activation
export function whenActivated(fn: () => void): void {
  const doc = document as Document & { prerendering?: boolean };
  if (doc.prerendering) {
    doc.addEventListener("prerenderingchange", () => fn(), { once: true });
  } else {
    fn();
  }
}

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

// Runs fn once the main thread is idle, or after timeoutMs at the latest.
// Browsers without requestIdleCallback get a macrotask, which still yields to
// pending paints and input. Returns a cancel function.
export function runWhenIdle(fn: () => void, timeoutMs = 2000): () => void {
  const w = window as IdleWindow;
  if (typeof w.requestIdleCallback === "function") {
    const handle = w.requestIdleCallback(() => fn(), { timeout: timeoutMs });
    return () => {
      if (typeof w.cancelIdleCallback === "function") {
        w.cancelIdleCallback(handle);
      }
    };
  }
  const handle = setTimeout(fn, 0);
  return () => clearTimeout(handle);
}

// runWhenIdle, but only after prerender activation and the window load
// event, so heavy work stays out of the page's startup. Returns a cancel
// function.
export function runWhenIdleAfterLoad(
  fn: () => void,
  timeoutMs = 2000,
): () => void {
  let cancelled = false;
  let cancelIdle: (() => void) | null = null;
  const onLoad = () => {
    if (cancelled) return;
    cancelIdle = runWhenIdle(fn, timeoutMs);
  };
  whenActivated(() => {
    if (cancelled) return;
    if (document.readyState === "complete") {
      onLoad();
    } else {
      window.addEventListener("load", onLoad, { once: true });
    }
  });
  return () => {
    cancelled = true;
    window.removeEventListener("load", onLoad);
    if (cancelIdle) cancelIdle();
  };
}
