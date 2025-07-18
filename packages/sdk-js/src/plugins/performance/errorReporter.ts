import { EventProperties, UserContext } from "../../types/growthbook";
import { GrowthBookClient, UserScopedGrowthBook } from "../../GrowthBookClient";
import { GrowthBook } from "../../GrowthBook";
import { detectEnv, shouldSample, shouldLogAfterDebouncing } from "./util";

export type ErrorReporterSettings = {
  logEvent: (eventName: string, properties?: EventProperties) => void;
  debounceTimeout?: number;
  // sampling:
  samplingRate?: number;
  hashAttribute?: string;
  userContext?: UserContext;
  growthbook?: GrowthBook | GrowthBookClient | UserScopedGrowthBook;
};

// Internal type for Node error registry that extends ErrorReporterSettings with expiration
type ErrorHandlerWithExpiration = ErrorReporterSettings & {
  expiresAt: number;
};

export function createErrorReporter({
  logEvent,
  debounceTimeout = 100,
  samplingRate = 0.1,
  hashAttribute = "id",
  userContext,
  growthbook,
}: ErrorReporterSettings) {
  if (samplingRate < 0 || samplingRate > 1) {
    throw new Error("samplingRate must be between 0 and 1");
  }

  const env = detectEnv();

  // Debounce identical errors
  const lastErrorTimestamps = new Map<string, number>();

  if (env === "browser") {
    // Determine attributes for sampling
    const attributes = growthbook instanceof GrowthBook
      ? growthbook.getAttributes()
      : userContext?.attributes;

    if (
      !shouldSample({
        rate: samplingRate,
        hashAttribute,
        attributes,
        seed: "error-sampling",
      })
    ) {
      return;
    }
    window.addEventListener("error", (event) => {
      const message = event.message || "";
      const stack = event.error?.stack || "";
      if (shouldLogAfterDebouncing(message, stack, debounceTimeout, lastErrorTimestamps)) {
        logEvent("browser-error", {
          message,
          source: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          stack,
        });
      }
    });
    window.addEventListener("unhandledrejection", (event) => {
      const message = event.reason?.message || "Unhandled Promise rejection";
      const stack = event.reason?.stack || "";
      if (shouldLogAfterDebouncing(message, stack, debounceTimeout, lastErrorTimestamps)) {
        logEvent("browser-error", {
          message,
          stack,
        });
      }
    });

  } else if (env === "node") {
    // Instead of adding a single global listener that's bound to one specific logEvent function,
    // we need to manage a registry of error handlers so multiple SDK instances can report errors
    const symbol = Symbol.for("growthbook.nodeErrorReporter");

    // Default handler expiration time (30 minutes)
    const DEFAULT_EXPIRATION = 30 * 60 * 1000;

    // Initialize the registry if it doesn't exist
    if (!(globalThis as any)[symbol]) {
      (globalThis as any)[symbol] = {
        handlers: new Set<ErrorHandlerWithExpiration>(),
        initialized: false,
        lastCleanup: Date.now()
      };
    }

    const registry = (globalThis as any)[symbol];

    // Store this handler in the registry with expiration
    const now = Date.now();
    const handler: ErrorHandlerWithExpiration = {
      logEvent,
      debounceTimeout,
      samplingRate,
      hashAttribute,
      userContext,
      growthbook,
      expiresAt: now + DEFAULT_EXPIRATION
    };
    registry.handlers.add(handler);

    // Helper function to clean up expired handlers
    const cleanupExpiredHandlers = () => {
      const now = Date.now();
      let expiredCount = 0;

      registry.handlers.forEach((handler: ErrorHandlerWithExpiration) => {
        // Remove handlers that have expired
        if (handler.expiresAt < now) {
          registry.handlers.delete(handler);
          expiredCount++;
        }
      });

      // Update last cleanup time
      registry.lastCleanup = now;

      return expiredCount;
    };

    // Only set up the actual process listeners once
    if (!registry.initialized) {
      registry.initialized = true;

      // Set up a cleanup interval (every 5 minutes)
      const CLEANUP_INTERVAL = 5 * 60 * 1000;
      const cleanupInterval = setInterval(() => {
        cleanupExpiredHandlers();

        // If there are no handlers left, clear the interval
        if (registry.handlers.size === 0) {
          clearInterval(cleanupInterval);
          registry.initialized = false;
        }
      }, CLEANUP_INTERVAL);

      // Make sure the interval doesn't prevent the process from exiting
      if (cleanupInterval.unref) {
        cleanupInterval.unref();
      }

      process.on("uncaughtException", (err) => {
        const message = err?.message || "Uncaught Exception";
        const stack = err?.stack || "";
        const now = Date.now();

        // Clean up expired handlers if it's been a while
        if (now - registry.lastCleanup > CLEANUP_INTERVAL) {
          cleanupExpiredHandlers();
        }

        // Extend expiration for all handlers whenever an error occurs
        // This prevents handlers from expiring if the app has no errors for a while
        registry.handlers.forEach((handler: ErrorHandlerWithExpiration) => {
          handler.expiresAt = now + DEFAULT_EXPIRATION;
        });

        // Call registered handlers that pass sampling and debouncing
        registry.handlers.forEach((handler: ErrorHandlerWithExpiration) => {
          const {
            logEvent,
            samplingRate = 0.1,
            hashAttribute = "id",
            userContext,
            growthbook,
            debounceTimeout = 100
          } = handler;

          // Use a handler-specific timestamps map for debouncing
          const timestamps = new Map<string, number>();

          // Determine attributes for sampling
          const attributes = growthbook instanceof GrowthBook
            ? growthbook.getAttributes()
            : userContext?.attributes;

          if (
            shouldSample({
              rate: samplingRate,
              hashAttribute,
              attributes,
              seed: "error-sampling",
            }) &&
            shouldLogAfterDebouncing(message, stack, debounceTimeout, timestamps)
          ) {

            logEvent("node-error", {
              message,
              stack,
            });
          }
        });
      });

      process.on("unhandledRejection", (reason: any) => {
        const message = reason?.message || "Unhandled Promise rejection";
        const stack = reason?.stack || "";
        const now = Date.now();

        // Clean up expired handlers if it's been a while
        if (now - registry.lastCleanup > CLEANUP_INTERVAL) {
          cleanupExpiredHandlers();
        }

        // Extend expiration for all handlers whenever an error occurs
        // This prevents handlers from expiring if the app has no errors for a while
        registry.handlers.forEach((handler: ErrorHandlerWithExpiration) => {
          handler.expiresAt = now + DEFAULT_EXPIRATION;
        });

        // Call registered handlers that pass sampling and debouncing
        registry.handlers.forEach((handler: ErrorHandlerWithExpiration) => {
          const {
            logEvent,
            samplingRate = 0.1,
            hashAttribute = "id",
            userContext,
            growthbook,
            debounceTimeout = 100
          } = handler;

          // Use a handler-specific timestamps map for debouncing
          const timestamps = new Map<string, number>();

          // Determine attributes for sampling
          const attributes = growthbook instanceof GrowthBook
            ? growthbook.getAttributes()
            : userContext?.attributes;

          if (
            shouldSample({
              rate: samplingRate,
              hashAttribute,
              attributes,
              seed: "error-sampling",
            }) &&
            shouldLogAfterDebouncing(message, stack, debounceTimeout, timestamps)
          ) {

            logEvent("node-error", {
              message,
              stack,
            });
          }
        });
      });
    }
  }
}
