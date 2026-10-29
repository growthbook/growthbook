import type { NextRouter } from "next/router";

export function createNavigationCancellation() {
  // Next.js displays rejected Error instances before our browser listener runs.
  const error = { cancelled: true };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    if (event.reason !== error) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  // Suppress browser reporting only for this intentional cancellation.
  window.addEventListener("unhandledrejection", onUnhandledRejection, true);

  return {
    error,
    dispose: () =>
      window.removeEventListener(
        "unhandledrejection",
        onUnhandledRejection,
        true,
      ),
  };
}

// Shared by every unsaved-changes guard, so one confirmed dialog lets the navigation through all of them.
let confirmed = false;

export function isNavigationConfirmed() {
  return confirmed;
}

export async function runConfirmedNavigation(navigate: () => Promise<unknown>) {
  confirmed = true;
  try {
    await navigate();
  } finally {
    confirmed = false;
  }
}

// Cancels each unconfirmed route change that `intercept` claims; returns the cleanup.
export function interceptRouteChanges(
  events: NextRouter["events"],
  intercept: (url: string) => boolean,
) {
  const cancellation = createNavigationCancellation();
  const onRouteChangeStart = (url: string) => {
    if (confirmed || !intercept(url)) return;
    events.emit("routeChangeError", cancellation.error, url);
    // Next's pages router only cancels a route change when a handler throws.
    throw cancellation.error;
  };
  events.on("routeChangeStart", onRouteChangeStart);
  return () => {
    events.off("routeChangeStart", onRouteChangeStart);
    cancellation.dispose();
  };
}
