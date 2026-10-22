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
