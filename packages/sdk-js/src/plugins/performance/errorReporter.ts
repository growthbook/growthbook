import type { GrowthBook } from "../../GrowthBook";
import type {
  GrowthBookClient,
  UserScopedGrowthBook,
} from "../../GrowthBookClient";
import type { EventProperties, UserContext } from "../../types/growthbook";
import { detectEnv, shouldSample } from "./util";

export type ErrorReporterSettings = {
  debounceTimeout?: number;
  // Bounds memory usage of the dedupe cache on long-running pages
  dedupeCacheSize?: number;
  // sampling:
  samplingRate?: number;
  hashAttribute?: string;
  samplingSeed?: string;
  userContext?: UserContext;
  growthbook: GrowthBook | GrowthBookClient | UserScopedGrowthBook;
};

function logError(
  growthbook: GrowthBook | GrowthBookClient | UserScopedGrowthBook,
  properties: EventProperties,
  userContext?: UserContext,
) {
  // GrowthBookClient needs an explicit userContext on logEvent
  if ("createScopedInstance" in growthbook) {
    (growthbook as GrowthBookClient).logEvent(
      "browser-error",
      properties,
      userContext || ({} as UserContext),
    );
  } else {
    (growthbook as GrowthBook | UserScopedGrowthBook).logEvent(
      "browser-error",
      properties,
    );
  }
}

export function createErrorReporter({
  debounceTimeout = 100,
  dedupeCacheSize = 100,
  samplingRate = 1,
  hashAttribute = "id",
  samplingSeed,
  userContext,
  growthbook,
}: ErrorReporterSettings) {
  if (samplingRate < 0 || samplingRate > 1) {
    throw new Error("samplingRate must be between 0 and 1");
  }

  if (detectEnv() !== "browser") return;

  if (
    !shouldSample({
      rate: samplingRate,
      hashAttribute,
      attributes:
        growthbook && "getAttributes" in growthbook
          ? growthbook.getAttributes()
          : userContext?.attributes,
      seed: samplingSeed ?? "error-sampling",
    })
  ) {
    return;
  }

  // LRU-ish cache; insertion order preserved, oldest evicted when full
  const lastErrorTimestamps = new Map<string, number>();

  // Cross-origin "Script error." reports collapse to the same (message, stack)
  // pair, so we include source/lineno/colno to avoid masking real errors
  function buildDedupeKey(parts: {
    message: string;
    stack: string;
    source?: string;
    lineno?: number;
    colno?: number;
  }) {
    return [
      parts.message,
      parts.stack,
      parts.source ?? "",
      parts.lineno ?? "",
      parts.colno ?? "",
    ].join("|");
  }

  function shouldLogError(key: string) {
    if (debounceTimeout <= 0) return true;
    const now = Date.now();
    const last = lastErrorTimestamps.get(key) || 0;
    if (now - last < debounceTimeout) return false;
    // Re-insert to mark as most recent
    lastErrorTimestamps.delete(key);
    lastErrorTimestamps.set(key, now);
    while (lastErrorTimestamps.size > dedupeCacheSize) {
      const oldest = lastErrorTimestamps.keys().next().value;
      if (oldest === undefined) break;
      lastErrorTimestamps.delete(oldest);
    }
    return true;
  }

  const onError = (event: ErrorEvent) => {
    const message = event.message || "";
    const stack = event.error?.stack || "";
    const key = buildDedupeKey({
      message,
      stack,
      source: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
    if (!shouldLogError(key)) return;
    logError(
      growthbook,
      {
        message,
        source: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack,
      },
      userContext,
    );
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    // event.reason can be anything: Error, plain object, string, number, etc.
    // The previous cast silently dropped non-Error rejection values.
    const reason: unknown = event.reason;
    let message = "Unhandled Promise rejection";
    let stack = "";
    if (reason instanceof Error) {
      message = reason.message || message;
      stack = reason.stack || "";
    } else if (reason && typeof reason === "object") {
      const r = reason as { message?: unknown; stack?: unknown };
      if (typeof r.message === "string") message = r.message;
      else {
        try {
          message = JSON.stringify(reason);
        } catch {
          message = String(reason);
        }
      }
      typeof r.stack === "string" && (stack = r.stack);
    } else if (reason != null) {
      // primitive (string, number, boolean) — Promise.reject("...") is common
      message = String(reason);
    }
    if (!shouldLogError(buildDedupeKey({ message, stack }))) return;
    logError(growthbook, { message, stack }, userContext);
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  // Clean up on destroy so we don't leak listeners or log on a dead instance
  "onDestroy" in growthbook &&
    growthbook.onDestroy(() => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      lastErrorTimestamps.clear();
    });
}
