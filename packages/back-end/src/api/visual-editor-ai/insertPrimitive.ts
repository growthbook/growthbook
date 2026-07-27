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
  // Only skip the wrapper when the token is a class on the ROOT element — not
  // just present somewhere in the markup. If the model put the class on a
  // child (or in text / an inline style) but not the root, we must still wrap,
  // otherwise the root lacks the class the insert script's idempotency guard
  // and the scoped CSS rely on. The token is a controlled `gbf-…` slug (see
  // makeScopeToken), so it's safe to embed in the RegExp.
  const rootTag = html.match(/^<[^>]+>/)?.[0] ?? "";
  const rootHasScope = new RegExp(
    `\\bclass=["'][^"']*\\b${scopeToken}\\b`,
  ).test(rootTag);
  return rootHasScope ? html : `<div class="${scopeToken}">${html}</div>`;
}

// insertAdjacentHTML throws for "beforebegin"/"afterend" on the <html> root —
// you can't add a sibling to the document's root element. The AI-edit schema
// lets the model target "html"/":root", so remap those two impossible cases to
// the equivalent spot inside <body> (top/bottom of the page) instead of letting
// the insert throw (and silently no-op behind buildInsertJs's try/catch).
// Everything else passes through unchanged. Apply this BEFORE building the
// script AND the preview descriptor so both agree on where the node lands.
export function normalizeInsertPlacement(
  targetSelector: string,
  position: InsertPosition,
): { targetSelector: string; position: InsertPosition } {
  const isRoot = /^\s*(?:html|:root)\s*$/i.test(targetSelector);
  if (isRoot && position === "beforebegin") {
    return { targetSelector: "body", position: "afterbegin" };
  }
  if (isRoot && position === "afterend") {
    return { targetSelector: "body", position: "beforeend" };
  }
  return { targetSelector, position };
}

// Build a self-contained, idempotent insertion script for the variation's
// `js` field. It runs once in the SDK (and our editor preview), guards on the
// unique scope class so it never double-inserts, and waits (bounded to 10s)
// for late/SPA-rendered targets before giving up — so it never loops. The
// insertAdjacentHTML call is wrapped in try/catch: some position + target
// combinations throw (e.g. "beforebegin"/"afterend" on the <html> root), and
// an uncaught throw here would abort the rest of the variation's JS. We treat
// a throw as a clean give-up (return true) rather than letting it propagate.
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
  return `(function(){var S=${S};function ins(){if(document.querySelector("."+S))return true;var t=document.querySelector(${T});if(!t)return false;try{t.insertAdjacentHTML(${P},${H});}catch(e){}return true;}if(ins())return;var mo=new MutationObserver(function(){if(ins())mo.disconnect();});mo.observe(document.documentElement,{childList:true,subtree:true});setTimeout(function(){mo.disconnect();},10000);})();`;
}
