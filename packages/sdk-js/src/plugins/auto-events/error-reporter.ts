import type { GrowthBook } from "../../GrowthBook";
import type {
  GrowthBookClient,
  UserScopedGrowthBook,
} from "../../GrowthBookClient";
import type { EventProperties, UserContext } from "../../types/growthbook";
import { DEFAULT_SAMPLING_SEED, shouldSample } from "../utils/sampling";
import { detectEnv } from "../utils/browser";
import { isFullGrowthBook, isGrowthBookClient } from "../utils/instance";

export type ErrorReporterSettings = {
  debounceTimeout?: number;
  samplingRate?: number;
  hashAttribute?: string;
  samplingSeed?: string;
  userContext?: UserContext;
  growthbook: GrowthBook | GrowthBookClient | UserScopedGrowthBook;
};

const MAX_MESSAGE_LENGTH = 1000;
const DEDUPE_CACHE_SIZE = 100;
const MAX_STACK_LENGTH = 4000;

function logError(
  growthbook: GrowthBook | GrowthBookClient | UserScopedGrowthBook,
  properties: EventProperties,
  userContext?: UserContext,
) {
  if (typeof properties.message === "string") {
    properties.message = properties.message.slice(0, MAX_MESSAGE_LENGTH);
  }
  if (typeof properties.stack === "string") {
    properties.stack = properties.stack.slice(0, MAX_STACK_LENGTH);
  }
  // GrowthBookClient needs an explicit userContext on logEvent
  if (isGrowthBookClient(growthbook)) {
    growthbook.logEvent(
      "browser_error",
      properties,
      userContext || ({} as UserContext),
    );
  } else {
    (growthbook as GrowthBook | UserScopedGrowthBook).logEvent(
      "browser_error",
      properties,
    );
  }
}

export function createErrorReporter({
  debounceTimeout = 100,
  samplingRate = 1,
  hashAttribute = "id",
  samplingSeed,
  userContext,
  growthbook,
}: ErrorReporterSettings) {
  samplingRate = Math.min(1, Math.max(0, samplingRate));

  if (detectEnv() !== "browser") return;

  if (
    !shouldSample({
      rate: samplingRate,
      hashAttribute,
      attributes: isFullGrowthBook(growthbook)
        ? growthbook.getAttributes()
        : userContext
          ? userContext.attributes
          : undefined,
      seed: samplingSeed ?? DEFAULT_SAMPLING_SEED,
    })
  ) {
    return;
  }

  // Insertion-ordered; oldest evicted when full
  const lastErrorTimestamps = new Map<string, number>();

  // Cross-origin "Script error." reports share message+stack; source/line/col
  // keep them distinct
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

  // Debounce is per error key; a throwing interval with varying messages
  // would otherwise emit indefinitely
  const MAX_ERRORS_PER_PAGE = 100;
  let errorsLogged = 0;

  function shouldLogError(key: string) {
    if (errorsLogged >= MAX_ERRORS_PER_PAGE) return false;
    if (debounceTimeout > 0) {
      const now = Date.now();
      const last = lastErrorTimestamps.get(key) || 0;
      if (now - last < debounceTimeout) return false;
      lastErrorTimestamps.delete(key);
      lastErrorTimestamps.set(key, now);
      while (lastErrorTimestamps.size > DEDUPE_CACHE_SIZE) {
        const oldest = lastErrorTimestamps.keys().next().value;
        if (oldest === undefined) break;
        lastErrorTimestamps.delete(oldest);
      }
    }
    errorsLogged++;
    return true;
  }

  const onError = (event: ErrorEvent) => {
    const message = event.message || "";
    const stack = (event.error && event.error.stack) || "";
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
        // Never serialize arbitrary rejection values — API responses and
        // config objects routinely carry tokens or PII
        const keys = Object.keys(reason).slice(0, 10).join(", ");
        message = `Non-Error promise rejection captured with keys: ${keys}`;
      }
      typeof r.stack === "string" && (stack = r.stack);
    } else if ((reason ?? null) !== null) {
      message = String(reason);
    }
    if (!shouldLogError(buildDedupeKey({ message, stack }))) return;
    logError(growthbook, { message, stack }, userContext);
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  isFullGrowthBook(growthbook) &&
    growthbook.onDestroy(() => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      lastErrorTimestamps.clear();
    });
}
