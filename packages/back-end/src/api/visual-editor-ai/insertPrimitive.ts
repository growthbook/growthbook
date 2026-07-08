// Shared insert primitive for the Visual Editor AI endpoints.
//
// Adding new DOM (a banner, a section, a component) must NOT go through a
// dom-mutator `html` mutation: `append` re-fires dom-mutator's MutationObserver
// and multiplies the inserted markup (a guaranteed freeze on `body`), and
// `set` on a container replaces its entire contents (wiping the page on
// body/html). Instead we inject through the variation's `js` field with an
// idempotent `insertAdjacentHTML` snippet — the SDK runs `js` once as a
// <script>, with no observer, so it can't loop or duplicate.
//
// Both postFigmaToVariant (component injection) and postAIEdit (AI "add a
// banner" edits) build inserts the same way, so the primitive lives here.

import { v4 as uuidv4 } from "uuid";

// The four insertAdjacentHTML positions, relative to the target element:
//   beforebegin — before the element (previous sibling)
//   afterbegin  — inside the element, as its first child
//   beforeend   — inside the element, as its last child
//   afterend    — after the element (next sibling)
export type InsertPosition =
  | "beforebegin"
  | "afterbegin"
  | "beforeend"
  | "afterend";

export const INSERT_POSITIONS: readonly InsertPosition[] = [
  "beforebegin",
  "afterbegin",
  "beforeend",
  "afterend",
] as const;

// A unique scope class for one injected component. Doubles as the
// idempotency guard in the insert script (never insert twice) and, for the
// Figma path, the prefix every scoped CSS rule hangs off of.
export function makeScopeToken(): string {
  return `gbf-${uuidv4().replace(/-/g, "").slice(0, 8)}`;
}

// Guarantee the injected markup has a single root carrying the scope class,
// so (a) the insert script's idempotency check has something to match and
// (b) the Figma path's scoped CSS applies. Wraps only when the token isn't
// already present (the model is asked to include it, but wrap defensively).
export function wrapWithScope(rawHtml: string, scopeToken: string): string {
  const html = rawHtml.trim();
  return html.includes(scopeToken)
    ? html
    : `<div class="${scopeToken}">${html}</div>`;
}

// Build a self-contained, idempotent insertion script for the variation's
// `js` field. It runs once in the SDK (and our editor preview), guards on the
// unique scope class so it never double-inserts, and waits (bounded to 10s)
// for late/SPA-rendered targets before giving up — so it never loops.
export function buildInsertJs({
  scopeToken,
  targetSelector,
  position,
  html,
}: {
  scopeToken: string;
  targetSelector: string;
  position: InsertPosition;
  html: string;
}): string {
  const S = JSON.stringify(scopeToken);
  const T = JSON.stringify(targetSelector);
  const P = JSON.stringify(position);
  const H = JSON.stringify(html);
  return `(function(){var S=${S};function ins(){if(document.querySelector("."+S))return true;var t=document.querySelector(${T});if(!t)return false;t.insertAdjacentHTML(${P},${H});return true;}if(ins())return;var mo=new MutationObserver(function(){if(ins())mo.disconnect();});mo.observe(document.documentElement,{childList:true,subtree:true});setTimeout(function(){mo.disconnect();},10000);})();`;
}
