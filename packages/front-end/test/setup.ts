import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";

// Portal component requires a #portal-root element in the DOM
beforeEach(() => {
  if (!document.getElementById("portal-root")) {
    const portalRoot = document.createElement("div");
    portalRoot.id = "portal-root";
    document.body.appendChild(portalRoot);
  }
});

// Mock ResizeObserver for tests (not available in jsdom)
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
