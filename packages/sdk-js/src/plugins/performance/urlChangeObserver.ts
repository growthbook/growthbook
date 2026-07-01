// Shared SPA URL-change observer; one set of patches across reporters.
// Detection: navigatesuccess > history pushState/replaceState + popstate > polling (opt-in)

type UrlChangeListener = (newPath: string, oldPath: string | null) => void;

type SubscribeOptions = {
  // Per-subscriber — does not leak across subscribers
  trackQueryString?: boolean;
  // Module-level (shared timer); most-permissive-wins once on, stays on
  enablePolling?: boolean;
  pollIntervalMs?: number;
};

type Subscriber = {
  cb: UrlChangeListener;
  trackQueryString: boolean;
  lastPath: string | null;
};

const subscribers = new Set<Subscriber>();
let initialized = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollingEnabled = false;
let pollIntervalMs = 500;

function getCurrentPath(trackQueryString: boolean): string {
  return (
    window.location.origin +
    window.location.pathname +
    (trackQueryString ? window.location.search : "")
  );
}

function notifyIfChanged() {
  // Each subscriber sees its own URL view (per-subscriber trackQueryString)
  subscribers.forEach((sub) => {
    const newPath = getCurrentPath(sub.trackQueryString);
    if (newPath === sub.lastPath) return;
    const oldPath = sub.lastPath;
    sub.lastPath = newPath;
    try {
      sub.cb(newPath, oldPath);
    } catch {
      // noop
    }
  });
}

function startPolling() {
  if (pollTimer) return;
  const poll = () => {
    notifyIfChanged();
    pollTimer = setTimeout(poll, pollIntervalMs);
  };
  pollTimer = setTimeout(poll, pollIntervalMs);
}

function stopPolling() {
  pollTimer && clearTimeout(pollTimer);
  pollTimer = null;
}

function initialize() {
  if (initialized) return;
  initialized = true;

  // Navigation API (Chromium); the older `navigate` event is unreliable
  const nav = (window as Window & { navigation?: EventTarget }).navigation;
  nav &&
    typeof nav.addEventListener === "function" &&
    nav.addEventListener("navigatesuccess", notifyIfChanged);

  // History monkey-patch — once globally so we don't double-wrap
  const methods = ["pushState", "replaceState"] as const;
  methods.forEach((method) => {
    const original = window.history[method];
    window.history[method] = function (...args) {
      const result = original.apply(this, args);
      notifyIfChanged();
      return result;
    };
  });

  window.addEventListener("popstate", notifyIfChanged);

  pollingEnabled && startPolling();
}

// Subscribe to SPA URL changes; returns unsubscribe.
// trackQueryString is per-subscriber; polling is most-permissive-wins.
export function subscribeToUrlChanges(
  cb: UrlChangeListener,
  options: SubscribeOptions = {},
): () => void {
  if (typeof window === "undefined") return () => undefined;

  options.pollIntervalMs &&
    options.pollIntervalMs > 0 &&
    (pollIntervalMs = options.pollIntervalMs);
  if (options.enablePolling) {
    pollingEnabled = true;
    initialized && startPolling();
  }

  initialize();

  const trackQueryString = !!options.trackQueryString;
  const sub: Subscriber = {
    cb,
    trackQueryString,
    lastPath: getCurrentPath(trackQueryString),
  };
  subscribers.add(sub);

  return () => {
    subscribers.delete(sub);
    // No subs left → drop the timer; history patches stay (others may have wrapped them)
    subscribers.size === 0 && stopPolling();
  };
}

// test-only
export function _resetUrlChangeObserverForTests() {
  subscribers.clear();
  initialized = false;
  pollingEnabled = false;
  pollIntervalMs = 500;
  stopPolling();
}
