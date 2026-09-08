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
