import { flushSync } from "react-dom";

// Animates a state change between the page before and after it, using the
// browser's view transitions. Where they're unsupported, or the viewer prefers
// less motion, the change applies at once.
export function withViewTransition(update: () => void): void {
  if (
    typeof document === "undefined" ||
    typeof document.startViewTransition !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    update();
    return;
  }
  document.startViewTransition(() => flushSync(update));
}
