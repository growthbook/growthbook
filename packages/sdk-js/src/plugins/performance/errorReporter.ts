import { GrowthBook } from "../../GrowthBook";
import type {
  GrowthBookClient,
  UserScopedGrowthBook,
} from "../../GrowthBookClient";
import type { EventProperties, UserContext } from "../../types/growthbook";
import { detectEnv, shouldSample } from "./util";

export type ErrorReporterSettings = {
  debounceTimeout?: number;
  // sampling:
  samplingRate?: number;
  hashAttribute?: string;
  userContext?: UserContext;
  growthbook: GrowthBook | GrowthBookClient | UserScopedGrowthBook;
};

export function createErrorReporter({
  debounceTimeout = 100,
  samplingRate = 1,
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

  function shouldLogError(message: string, stack: string) {
    const key = message + stack;
    if (debounceTimeout > 0) {
      const now = Date.now();
      const last = lastErrorTimestamps.get(key) || 0;
      if (now - last < debounceTimeout) {
        return false;
      }
      lastErrorTimestamps.set(key, now);
    }
    return true;
  }

  if (env === "browser") {
    if (
      !shouldSample({
        rate: samplingRate,
        hashAttribute,
        attributes:
          growthbook && "getAttributes" in growthbook
            ? growthbook.getAttributes()
            : userContext?.attributes,
        seed: "error-sampling",
      })
    ) {
      return;
    }
    window.addEventListener("error", (event) => {
      const message = event.message || "";
      const stack = event.error?.stack || "";
      if (shouldLogError(message, stack)) {
        const properties = {
          message,
          source: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          stack,
        };
        if (growthbook.logEvent.length === 3) {
          (
            growthbook.logEvent as (
              eventName: string,
              properties: EventProperties,
              userContext: UserContext,
            ) => void
          )("browser-error", properties, userContext || {});
        } else {
          (
            growthbook.logEvent as (
              eventName: string,
              properties?: EventProperties,
            ) => void
          )("browser-error", properties);
        }
      }
    });
    window.addEventListener("unhandledrejection", (event) => {
      const message = event.reason?.message || "Unhandled Promise rejection";
      const stack = event.reason?.stack || "";
      const properties = {
        message,
        stack,
      };
      if (shouldLogError(message, stack)) {
        if (growthbook.logEvent.length === 3) {
          (
            growthbook.logEvent as (
              eventName: string,
              properties: EventProperties,
              userContext: UserContext,
            ) => void
          )("browser-error", properties, userContext || {});
        } else {
          (
            growthbook.logEvent as (
              eventName: string,
              properties?: EventProperties,
            ) => void
          )("browser-error", properties);
        }
      }
    });
  }
}
