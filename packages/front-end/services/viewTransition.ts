import { flushSync } from "react-dom";

let running = 0;

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
  // Names apply only while this class is on (see global.scss).
  const root = document.documentElement;
  running++;
  root.classList.add("view-transitioning");
  const done = () => {
    if (--running === 0) root.classList.remove("view-transitioning");
  };
  document
    .startViewTransition(() => flushSync(update))
    .finished.then(done, done);
}
