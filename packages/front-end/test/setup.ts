import * as matchers from "@testing-library/jest-dom/matchers";
import { expect, beforeEach } from "vitest";

expect.extend(matchers);

// Specs default to the node environment, so guard anything that needs a DOM.
const hasDom = typeof document !== "undefined";

// Portal component requires a #portal-root element in the DOM
beforeEach(() => {
  if (!hasDom) return;
  if (!document.getElementById("portal-root")) {
    const portalRoot = document.createElement("div");
    portalRoot.id = "portal-root";
    document.body.appendChild(portalRoot);
  }
});

// Mock ResizeObserver for tests (not available in jsdom)
if (hasDom) {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
