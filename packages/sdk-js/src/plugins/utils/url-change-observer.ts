// Shared SPA URL-change observer; one set of patches across reporters.
// Detection: navigatesuccess > history pushState/replaceState + popstate

type UrlChangeListener = (newPath: string, oldPath: string | null) => void;

type SubscribeOptions = {
  // Per-subscriber — does not leak across subscribers
  trackQueryString?: boolean;
};

type Subscriber = {
  cb: UrlChangeListener;
  trackQueryString: boolean;
  lastPath: string | null;
};

const subscribers = new Set<Subscriber>();
let initialized = false;

function getCurrentPath(trackQueryString: boolean): string {
  return (
    window.location.origin +
    window.location.pathname +
    (trackQueryString ? window.location.search : "")
  );
}

function notifyIfChanged() {
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
}

// Subscribe to SPA URL changes; returns unsubscribe.
export function subscribeToUrlChanges(
  cb: UrlChangeListener,
  options: SubscribeOptions = {},
): () => void {
  if (typeof window === "undefined") return () => undefined;

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
  };
}

// test-only
export function _resetUrlChangeObserverForTests() {
  subscribers.clear();
  initialized = false;
}
