import type { GrowthBook } from "../../GrowthBook";
import type { GrowthBookClient, UserScopedGrowthBook } from "../../GrowthBookClient";
import type { EventProperties, UserContext } from "../../types/growthbook";
import { createErrorReporter } from "./errorReporter";
import { detectEnv } from "./util";

export type NodePerformanceSettings = {
  samplingRate?: number;
  hashAttribute?: string;
  trackErrors?: boolean;
  debounceErrorTimeout?: number;
};

export function nodePerformancePlugin({
  samplingRate = 0.1,
  hashAttribute = "id",
  trackErrors = true,
  debounceErrorTimeout = 1000,
}: NodePerformanceSettings = {}) {
  if (detectEnv() !== "node") {
    throw new Error("nodePerformancePlugin only works in Node.js environments");
  }

  return (gb: GrowthBook | GrowthBookClient | UserScopedGrowthBook) => {
    if (!trackErrors) return;

    let logEvent: (eventName: string, properties?: EventProperties) => void;

    if (typeof (gb as any).logEvent === "function") {
      logEvent = (gb as any).logEvent.bind(gb);
    } else {
      throw new Error("GrowthBook instance must have a logEvent method");
    }

    let userContext: UserContext | undefined = undefined;
    if (typeof (gb as any).getUserContext === "function") {
      userContext = (gb as any).getUserContext();
    }

    // Store the handler settings without expiration metadata
    const handlerSettings = {
      logEvent,
      debounceTimeout: debounceErrorTimeout,
      samplingRate,
      hashAttribute,
      userContext,
      growthbook: gb
    };

    createErrorReporter(handlerSettings);

    // Register a cleanup function for when the GrowthBook instance is destroyed
    // This provides immediate cleanup when destroy() is called, but we don't rely on it
    if (typeof (gb as any).onDestroy === "function") {
      (gb as any).onDestroy(() => {
        // Remove this handler from the registry
        const symbol = Symbol.for("growthbook.nodeErrorReporter");
        const registry = (globalThis as any)[symbol];
        if (registry && registry.handlers) {
          registry.handlers.delete(handlerSettings as any);
        }
      });
    }
  };
}
