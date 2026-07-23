import { EVENT_GROWTHBOOK_ERROR } from "../core";
import type { Attributes, UserContext } from "../types/growthbook";
import { GrowthBook } from "../GrowthBook";
import { GrowthBookClient, UserScopedGrowthBook } from "../GrowthBookClient";

export type ErrorTrackingStackFrame = {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
};

/** Optional metadata passed to {@link captureGrowthBookError} as `props` (like `logEvent`). */
export type GrowthBookErrorEventProps = Record<string, unknown>;

export type CaptureGrowthBookErrorOptions = {
  gb: GrowthBook | UserScopedGrowthBook | GrowthBookClient;
  error: unknown;
  props?: GrowthBookErrorEventProps;
  /** Override issue grouping for this error. A string is used as-is; an array is hashed server-side. */
  fingerprint?: string | readonly string[];
  /** Required when `gb` is a {@link GrowthBookClient}. */
  userContext?: UserContext;
};

function stringifyUnknown(err: unknown): {
  message: string;
  stack?: string;
  name?: string;
} {
  if (err instanceof Error) {
    return {
      message: err.message || err.name || "Error",
      stack: err.stack,
      name: err.name || "Error",
    };
  }
  if (typeof err === "string") {
    return { message: err };
  }
  try {
    return { message: JSON.stringify(err) };
  } catch {
    return { message: String(err) };
  }
}

/** Best-effort stack frame parsing (Chrome / Safari / Firefox-ish lines). */
export function parseStackFrames(stack?: string): ErrorTrackingStackFrame[] {
  if (!stack) return [];
  const frames: ErrorTrackingStackFrame[] = [];
  const lines = stack.split("\n");
  const chromeRe =
    /^\s*at (?:(?:async\s+)?([^()]+?)\s+)?\(?(.+?):(\d+):(\d+)\)?$/;
  const firefoxRe = /^(.*?)@(.+?):(\d+):(\d+)$/;

  for (const raw of lines) {
    const line = raw.trim();
    let m = chromeRe.exec(line);
    if (!m) {
      m = firefoxRe.exec(line) as RegExpExecArray | null;
    }
    if (m) {
      frames.push({
        function: (m[1] || "").trim() || undefined,
        filename: m[2],
        lineno: parseInt(m[3] || "0", 10) || undefined,
        colno: parseInt(m[4] || "0", 10) || undefined,
      });
    }
  }
  return frames;
}

function dedupeKeyForError(
  error: unknown,
  props?: GrowthBookErrorEventProps,
): string {
  if (typeof props?.fingerprint === "string" && props.fingerprint.trim()) {
    return props.fingerprint.trim();
  }
  if (
    Array.isArray(props?.fingerprintParts) &&
    (props.fingerprintParts as string[]).length > 0
  ) {
    return (props.fingerprintParts as string[]).join("\n");
  }
  const { message, stack } = stringifyUnknown(error);
  const frame = stack
    ?.split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return `${message}\n${frame || ""}`;
}

export type BuiltErrorEventProps = {
  /** Override issue grouping; otherwise computed in the ingestor. */
  fingerprint?: string;
  fingerprintParts?: string[];
  /** Human-readable issue line; same as {@link BuiltErrorEventProps.message}. */
  title: string;
  /** Full `Error.message` for display and search in the warehouse. */
  message: string;
  errorType: string;
  stack?: string;
  stackFrames: ErrorTrackingStackFrame[];
  transaction?: string;
  release?: string;
  runtime?: string;
  tags?: Record<string, string>;
  contexts?: Record<string, unknown>;
  breadcrumbs?: { ts: number; type: string; message: string }[];
  handled?: boolean;
};

export function buildErrorEventProperties({
  error,
  props,
}: {
  error: unknown;
  props?: GrowthBookErrorEventProps;
}): BuiltErrorEventProps & Record<string, unknown> {
  const { message, stack, name } = stringifyUnknown(error);
  const stackFrames = parseStackFrames(stack);

  const {
    errorType,
    transaction,
    release,
    runtime,
    tags,
    contexts,
    breadcrumbs,
    handled,
    fingerprint: propsFingerprint,
    fingerprintParts: propsFingerprintParts,
    title: _propsTitle,
    message: _propsMessage,
    ...rest
  } = props || {};

  const displayMessage =
    message.length > 500 ? `${message.slice(0, 497)}...` : message;

  const built: BuiltErrorEventProps & Record<string, unknown> = {
    ...rest,
    title: displayMessage,
    message: displayMessage,
    errorType: typeof errorType === "string" ? errorType : name || "unknown",
    stack: stack?.slice(0, 50_000),
    stackFrames,
    transaction: typeof transaction === "string" ? transaction : undefined,
    release: typeof release === "string" ? release : undefined,
    runtime:
      typeof runtime === "string"
        ? runtime
        : typeof navigator !== "undefined"
          ? "browser"
          : "javascript",
    tags:
      tags && typeof tags === "object"
        ? (tags as Record<string, string>)
        : undefined,
    contexts:
      contexts && typeof contexts === "object"
        ? (contexts as Record<string, unknown>)
        : undefined,
    breadcrumbs: Array.isArray(breadcrumbs) ? breadcrumbs : undefined,
    handled: typeof handled === "boolean" ? handled : undefined,
  };

  if (typeof propsFingerprint === "string" && propsFingerprint.trim()) {
    built.fingerprint = propsFingerprint.trim();
  } else if (
    Array.isArray(propsFingerprintParts) &&
    propsFingerprintParts.length > 0
  ) {
    built.fingerprintParts = propsFingerprintParts.map((part) => String(part));
  }

  return built;
}

async function logError({
  gb,
  error,
  props,
  fingerprint,
  userContext,
}: CaptureGrowthBookErrorOptions): Promise<void> {
  const fingerprintProps: GrowthBookErrorEventProps =
    fingerprint !== undefined
      ? typeof fingerprint === "string"
        ? { fingerprint }
        : { fingerprintParts: [...fingerprint] }
      : {};
  const eventProps = buildErrorEventProperties({
    error,
    props: { ...fingerprintProps, ...props },
  });

  if (gb instanceof GrowthBook || gb instanceof UserScopedGrowthBook) {
    await gb.logEvent(EVENT_GROWTHBOOK_ERROR, eventProps);
    return;
  }

  if (gb instanceof GrowthBookClient) {
    if (!userContext) {
      console.warn(
        "captureGrowthBookError: pass userContext when gb is a GrowthBookClient.",
      );
      return;
    }
    gb.logEvent(EVENT_GROWTHBOOK_ERROR, eventProps, userContext);
  }
}

export async function captureGrowthBookError(
  options: CaptureGrowthBookErrorOptions,
): Promise<void> {
  await logError(options);
}

function defaultBrowserContexts(): Record<string, unknown> {
  if (typeof navigator === "undefined") return {};
  return {
    browser: {
      name: navigator.userAgent,
      language: navigator.language,
      cookieEnabled: navigator.cookieEnabled,
    },
    device: {
      screen:
        typeof screen !== "undefined" ? `${screen.width}x${screen.height}` : "",
      pixelRatio:
        typeof window !== "undefined" ? window.devicePixelRatio : undefined,
    },
  };
}

function readGrowthBookAttributes(
  gb: GrowthBook | UserScopedGrowthBook | GrowthBookClient,
  userContext?: UserContext,
): Attributes {
  if (userContext?.attributes) {
    return userContext.attributes;
  }

  try {
    if (gb instanceof UserScopedGrowthBook) {
      return gb.getUserContext().attributes || {};
    }
    if ("getAttributes" in gb && typeof gb.getAttributes === "function") {
      return gb.getAttributes() || {};
    }
    if (gb instanceof GrowthBookClient) {
      return gb.getGlobalAttributes();
    }
  } catch {
    /* ignore */
  }
  return {};
}

export function growthbookErrorTrackingPlugin({
  enable = true,
  captureUnhandled = true,
  captureUnhandledRejections = true,
  dedupeWindowMs = 2000,
  release,
  getRelease,
  runtime,
  getTransaction,
}: {
  enable?: boolean;
  captureUnhandled?: boolean;
  captureUnhandledRejections?: boolean;
  /** Suppress duplicate reports within a short window (by message/stack or custom fingerprint). */
  dedupeWindowMs?: number;
  release?: string;
  getRelease?: () => string | undefined;
  runtime?: string;
  getTransaction?: () => string | undefined;
} = {}) {
  return (gb: GrowthBook | UserScopedGrowthBook | GrowthBookClient) => {
    const browser = typeof window !== "undefined";

    const clientKey =
      "getClientKey" in gb && typeof gb.getClientKey === "function"
        ? gb.getClientKey()
        : null;
    if (!clientKey) {
      throw new Error(
        "clientKey must be specified to use GrowthBook error tracking",
      );
    }

    const recentDedupeKeys = new Map<string, number>();
    const resolveRelease = (props?: GrowthBookErrorEventProps) => {
      if (typeof props?.release === "string" && props.release) {
        return props.release;
      }
      const dynamicRelease = getRelease?.();
      if (typeof dynamicRelease === "string" && dynamicRelease) {
        return dynamicRelease;
      }
      return typeof release === "string" ? release : undefined;
    };

    const pluginUserContext =
      gb instanceof UserScopedGrowthBook ? gb.getUserContext() : undefined;

    const run = async (error: unknown, props?: GrowthBookErrorEventProps) => {
      if (!enable) return;

      const dedupeKey = dedupeKeyForError(error, props);
      const now = Date.now();
      const last = recentDedupeKeys.get(dedupeKey);
      if (last !== undefined && now - last < dedupeWindowMs) {
        return;
      }
      recentDedupeKeys.set(dedupeKey, now);

      const attrs = readGrowthBookAttributes(gb, pluginUserContext);
      const envTag =
        typeof attrs.environment === "string"
          ? attrs.environment
          : typeof attrs.gbEnvironment === "string"
            ? attrs.gbEnvironment
            : undefined;
      const resolvedRelease = resolveRelease(props);

      const tags: Record<string, string> = {
        ...(resolvedRelease ? { release: resolvedRelease } : {}),
        ...(envTag ? { environment: envTag } : {}),
      };

      await logError({
        gb,
        error,
        userContext: pluginUserContext,
        props: {
          ...props,
          release: resolvedRelease,
          runtime:
            props?.runtime ?? runtime ?? (browser ? "browser" : "javascript"),
          tags: { ...tags, ...(props?.tags as Record<string, string>) },
          contexts: {
            ...defaultBrowserContexts(),
            ...(typeof props?.contexts === "object" ? props.contexts : {}),
          },
        },
      });
    };

    if (!browser || (!captureUnhandled && !captureUnhandledRejections)) {
      return;
    }

    if (gb instanceof GrowthBookClient) {
      return;
    }

    const onError = (event: ErrorEvent) => {
      const err = event.error;
      void run(err ?? event.message, {
        errorType: "uncaught",
        handled: false,
        transaction: getTransaction?.(),
      });
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      void run(event.reason, {
        errorType: "unhandledrejection",
        handled: false,
        transaction: getTransaction?.(),
      });
    };

    if (captureUnhandled) {
      window.addEventListener("error", onError);
    }
    if (captureUnhandledRejections) {
      window.addEventListener("unhandledrejection", onRejection);
    }

    const cleanup = () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };

    if ("onDestroy" in gb && typeof gb.onDestroy === "function") {
      gb.onDestroy(cleanup);
    }
  };
}
