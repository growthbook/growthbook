import { EVENT_GROWTHBOOK_ERROR } from "../core";
import type { Attributes } from "../types/growthbook";
import { GrowthBook } from "../GrowthBook";
import {
  GrowthBookClient,
  UserScopedGrowthBook,
} from "../GrowthBookClient";

export type ErrorTrackingStackFrame = {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
};

type PendingFingerprint =
  | { type: "value"; value: string }
  | { type: "parts"; parts: string[] };

const pendingFingerprints = new WeakMap<
  GrowthBook | UserScopedGrowthBook,
  PendingFingerprint
>();

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

function consumePendingFingerprint(
  gb: GrowthBook | UserScopedGrowthBook | GrowthBookClient,
): PendingFingerprint | undefined {
  if (gb instanceof GrowthBook || gb instanceof UserScopedGrowthBook) {
    const pending = pendingFingerprints.get(gb);
    if (pending) {
      pendingFingerprints.delete(gb);
    }
    return pending;
  }
  return undefined;
}

/**
 * Override issue grouping for the next error reported on this GrowthBook
 * instance. The ingestor uses `fingerprint` as-is; `fingerprintParts` is hashed
 * server-side (similar to Sentry's `setFingerprint` array form).
 *
 * @example
 * setFingerprint(gb, ["checkout", "payment-failed"]);
 * await captureGrowthBookError(gb, err);
 */
export function setFingerprint(
  gb: GrowthBook | UserScopedGrowthBook,
  fingerprint: string | readonly string[],
): void {
  if (typeof fingerprint === "string") {
    const value = fingerprint.trim();
    if (!value) return;
    pendingFingerprints.set(gb, { type: "value", value });
    return;
  }
  const parts = fingerprint.map((part) => String(part)).filter(Boolean);
  if (!parts.length) return;
  pendingFingerprints.set(gb, { type: "parts", parts });
}

function dedupeKeyForError(error: unknown, extras?: Record<string, unknown>): string {
  const pending =
    extras && "_pendingFingerprint" in extras
      ? (extras._pendingFingerprint as PendingFingerprint | undefined)
      : undefined;
  if (pending?.type === "value") {
    return pending.value;
  }
  if (pending?.type === "parts") {
    return pending.parts.join("\n");
  }
  const { message, stack } = stringifyUnknown(error);
  const frame = stack?.split("\n").map((line) => line.trim()).find(Boolean);
  return `${message}\n${frame || ""}`;
}

export type BuiltErrorEventProps = {
  /** Set via {@link setFingerprint}; otherwise computed in the ingestor. */
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

export function buildErrorEventProperties(
  error: unknown,
  extras?: Record<string, unknown>,
  options?: {
    gb?: GrowthBook | UserScopedGrowthBook | GrowthBookClient;
  },
): BuiltErrorEventProps & Record<string, unknown> {
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
    fingerprint: extrasFingerprint,
    fingerprintParts: extrasFingerprintParts,
    title: _extrasTitle,
    message: _extrasMessage,
    ...rest
  } = extras || {};

  const pending = options?.gb ? consumePendingFingerprint(options.gb) : undefined;

  const displayMessage =
    message.length > 500 ? `${message.slice(0, 497)}...` : message;

  const props: BuiltErrorEventProps & Record<string, unknown> = {
    ...rest,
    title: displayMessage,
    message: displayMessage,
    errorType: typeof errorType === "string" ? errorType : name || "unknown",
    stack: stack?.slice(0, 50_000),
    stackFrames,
    transaction:
      typeof transaction === "string" ? transaction : undefined,
    release: typeof release === "string" ? release : undefined,
    runtime:
      typeof runtime === "string"
        ? runtime
        : typeof navigator !== "undefined"
          ? "browser"
          : "javascript",
    tags: tags && typeof tags === "object" ? (tags as Record<string, string>) : undefined,
    contexts:
      contexts && typeof contexts === "object"
        ? (contexts as Record<string, unknown>)
        : undefined,
    breadcrumbs: Array.isArray(breadcrumbs)
      ? breadcrumbs
      : undefined,
    handled: typeof handled === "boolean" ? handled : undefined,
  };

  if (pending?.type === "value") {
    props.fingerprint = pending.value;
  } else if (pending?.type === "parts") {
    props.fingerprintParts = pending.parts;
  } else if (typeof extrasFingerprint === "string" && extrasFingerprint.trim()) {
    props.fingerprint = extrasFingerprint.trim();
  } else if (
    Array.isArray(extrasFingerprintParts) &&
    extrasFingerprintParts.length > 0
  ) {
    props.fingerprintParts = extrasFingerprintParts.map((part) => String(part));
  }

  return props;
}

async function logError(
  gb: GrowthBook | UserScopedGrowthBook | GrowthBookClient,
  error: unknown,
  extras?: Record<string, unknown>,
) {
  const props = buildErrorEventProperties(error, extras, { gb });
  if (gb instanceof GrowthBook || gb instanceof UserScopedGrowthBook) {
    await gb.logEvent(EVENT_GROWTHBOOK_ERROR, props);
    return;
  }
  if (gb instanceof GrowthBookClient) {
    console.warn(
      "growthbookErrorTrackingPlugin: use GrowthBook or a scoped UserScopedGrowthBook instance (not the root GrowthBookClient).",
    );
  }
}

export async function captureGrowthBookError(
  gb: GrowthBook | UserScopedGrowthBook | GrowthBookClient,
  error: unknown,
  extras?: Record<string, unknown>,
): Promise<void> {
  await logError(gb, error, extras);
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
      screen: typeof screen !== "undefined" ? `${screen.width}x${screen.height}` : "",
      pixelRatio:
        typeof window !== "undefined" ? window.devicePixelRatio : undefined,
    },
  };
}

function readGrowthBookAttributes(
  gb: GrowthBook | UserScopedGrowthBook | GrowthBookClient,
): Attributes {
  try {
    if ("getAttributes" in gb && typeof gb.getAttributes === "function") {
      return gb.getAttributes() || {};
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
    const resolveRelease = (extras?: Record<string, unknown>) => {
      if (typeof extras?.release === "string" && extras.release) {
        return extras.release;
      }
      const dynamicRelease = getRelease?.();
      if (typeof dynamicRelease === "string" && dynamicRelease) {
        return dynamicRelease;
      }
      return typeof release === "string" ? release : undefined;
    };

    const run = async (error: unknown, extras?: Record<string, unknown>) => {
      if (!enable) return;

      const pending =
        gb instanceof GrowthBook || gb instanceof UserScopedGrowthBook
          ? pendingFingerprints.get(gb)
          : undefined;
      const dedupeKey = dedupeKeyForError(error, {
        ...extras,
        _pendingFingerprint: pending,
      });
      const now = Date.now();
      const last = recentDedupeKeys.get(dedupeKey);
      if (last !== undefined && now - last < dedupeWindowMs) {
        return;
      }
      recentDedupeKeys.set(dedupeKey, now);

      const attrs = readGrowthBookAttributes(gb);
      const envTag =
        typeof attrs.environment === "string"
          ? attrs.environment
          : typeof attrs.gbEnvironment === "string"
            ? attrs.gbEnvironment
            : undefined;
      const resolvedRelease = resolveRelease(extras);

      const tags: Record<string, string> = {
        ...(resolvedRelease ? { release: resolvedRelease } : {}),
        ...(envTag ? { environment: envTag } : {}),
      };

      await logError(gb, error, {
        ...extras,
        release: resolvedRelease,
        runtime: extras?.runtime ?? runtime ?? (browser ? "browser" : "javascript"),
        tags: { ...tags, ...(extras?.tags as Record<string, string>) },
        contexts: {
          ...defaultBrowserContexts(),
          ...(typeof extras?.contexts === "object" ? extras.contexts : {}),
        },
      });
    };

    if (!browser || (!captureUnhandled && !captureUnhandledRejections)) {
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
