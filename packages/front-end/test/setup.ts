import * as matchers from "@testing-library/jest-dom/matchers";
import { expect, beforeEach } from "vitest";

expect.extend(matchers);

// Specs run in the node environment unless they opt into jsdom, so everything
// below is skipped when there is no DOM to set up.
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
    observe() {
      // Mock implementation
    }
    unobserve() {
      // Mock implementation
    }
    disconnect() {
      // Mock implementation
    }
  };
}
