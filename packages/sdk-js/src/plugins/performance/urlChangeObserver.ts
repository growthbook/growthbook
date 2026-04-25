// Shared SPA URL-change observer. Multiple reporters subscribe to a single
// observer so we don't double-wrap history methods or run multiple timers.
//
// Detection paths (in order of preference):
//   1. `navigatesuccess` — fires after a Navigation API navigation commits
//   2. pushState/replaceState monkey-patch + `popstate` — covers all current
//      SPA routers (React Router, Next.js, Vue Router, etc.)
//   3. setInterval polling — opt-in fallback, off by default

type UrlChangeListener = (newPath: string, oldPath: string | null) => void;

type SubscribeOptions = {
  // Treat query-string changes (?foo=bar) as URL changes. Default: pathname-only.
  trackQueryString?: boolean;
  // Run a setInterval polling fallback. Off by default.
  enablePolling?: boolean;
  pollIntervalMs?: number;
};

const subscribers = new Set<UrlChangeListener>();
let initialized = false;
let lastSeenPath: string | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

// Most-permissive settings across all subscribers; once enabled, stay enabled.
let trackQueryString = false;
let pollingEnabled = false;
let pollIntervalMs = 500;

function getCurrentPath(): string {
  return (
    window.location.origin +
    window.location.pathname +
    (trackQueryString ? window.location.search : "")
  );
}

function notifyIfChanged() {
  const newPath = getCurrentPath();
  if (newPath === lastSeenPath) return;
  const oldPath = lastSeenPath;
  lastSeenPath = newPath;
  subscribers.forEach((cb) => {
    try {
      cb(newPath, oldPath);
    } catch {
      // noop — don't let one subscriber break others
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
  lastSeenPath = getCurrentPath();

  // Navigation API (Chromium); the older `navigate` event is unreliable
  const nav = (window as Window & { navigation?: EventTarget }).navigation;
  nav &&
    typeof nav.addEventListener === "function" &&
    nav.addEventListener("navigatesuccess", notifyIfChanged);

  // History API monkey-patch — done once globally so we don't double-wrap
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

// Subscribe to SPA URL changes; returns an unsubscribe function.
// Options are most-permissive-wins across all subscribers.
export function subscribeToUrlChanges(
  cb: UrlChangeListener,
  options: SubscribeOptions = {},
): () => void {
  if (typeof window === "undefined") return () => undefined;

  options.trackQueryString && (trackQueryString = true);
  options.pollIntervalMs &&
    options.pollIntervalMs > 0 &&
    (pollIntervalMs = options.pollIntervalMs);
  if (options.enablePolling) {
    pollingEnabled = true;
    initialized && startPolling();
  }

  initialize();
  // Refresh in case trackQueryString just toggled
  lastSeenPath = getCurrentPath();
  subscribers.add(cb);

  return () => {
    subscribers.delete(cb);
    // Stop the polling timer if no one is listening; the history patches
    // stay in place since other code may have wrapped them since.
    subscribers.size === 0 && stopPolling();
  };
}

// Test-only helper to reset module state
export function _resetUrlChangeObserverForTests() {
  subscribers.clear();
  initialized = false;
  lastSeenPath = null;
  trackQueryString = false;
  pollingEnabled = false;
  pollIntervalMs = 500;
  stopPolling();
}
