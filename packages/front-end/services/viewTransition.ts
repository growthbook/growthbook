import { flushSync } from "react-dom";

const NAME_ATTR = "data-view-transition-name";

// Marks an element to morph between its before and after states.
export function viewTransitionProps(name: string) {
  return { [NAME_ATTR]: name };
}

const marked = () => [
  ...document.querySelectorAll<HTMLElement>(`[${NAME_ATTR}]`),
];

// Nothing covers its corners: no sticky header, bar or scroll box edge.
function inFullView(el: HTMLElement): boolean {
  const { left, right, top, bottom } = el.getBoundingClientRect();
  return [
    [left + 2, top + 2],
    [right - 2, top + 2],
    [left + 2, bottom - 2],
    [right - 2, bottom - 2],
  ].every(([x, y]) => {
    const hit = document.elementFromPoint(x, y);
    return hit !== null && el.contains(hit);
  });
}

function nameMarked(names: Set<string>) {
  for (const el of marked()) {
    const name = el.getAttribute(NAME_ATTR) ?? "";
    if (names.has(name)) el.style.setProperty("view-transition-name", name);
  }
}

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
  // A named element paints above the whole page for the transition, so only
  // marked elements in full view morph; the rest cross-fade with the page.
  // Names come off afterwards: a named element is always a stacking context,
  // which would trap a row's full-screen editor.
  const names = new Set(
    marked()
      .filter(inFullView)
      .map((el) => el.getAttribute(NAME_ATTR) ?? ""),
  );
  nameMarked(names);
  running++;
  const done = () => {
    if (--running > 0) return;
    for (const el of marked()) el.style.removeProperty("view-transition-name");
  };
  document
    .startViewTransition(() => {
      flushSync(update);
      nameMarked(names);
    })
    .finished.then(done, done);
}
