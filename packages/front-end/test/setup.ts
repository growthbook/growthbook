import * as matchers from "@testing-library/jest-dom/matchers";
import { expect } from "vitest";

expect.extend(matchers);

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
