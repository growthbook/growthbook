import { EVENT_GROWTHBOOK_ERROR } from "../core";
import type { Attributes } from "../types/growthbook";
import { GrowthBook } from "../GrowthBook";
import { GrowthBookClient, UserScopedGrowthBook } from "../GrowthBookClient";

export type ErrorTrackingStackFrame = {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
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

const FINGERPRINT_FRAME_LIMIT = 3;
const NOISE_FRAME_PATH_RE =
  /(?:^|[/\\])(?:node_modules|next[/\\]dist|react-dom|webpack)(?:[/\\]|$)/i;

function hashFingerprintParts(parts: string[]): string {
  const raw = parts.filter(Boolean).join("\n");
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/**
 * Tagged-template errors: fingerprints use the literal source pattern with `{}`
 * for each `${...}` hole, so interpolated values do not split issues.
 *
 * JavaScript does not expose template segments on `Error.message`; use
 * `growthbookComposedError` (or set this symbol on your own `Error` subclass).
 */
export const GROWTHBOOK_COMPOSED_ERROR_PATTERN = Symbol.for(
  "growthbook.composedErrorPattern",
);

function getComposedErrorPattern(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const pattern = Reflect.get(error, GROWTHBOOK_COMPOSED_ERROR_PATTERN);
  return typeof pattern === "string" && pattern.trim().length
    ? pattern.trim()
    : undefined;
}

/**
 * Create an `Error` thrown from a template literal such that fingerprinting uses
 * the static text and `{}` placeholders instead of runtime interpolation.
 *
 * @example
 * throw growthbookComposedError`Checkout failed (trace ${crypto.randomUUID()})`;
 */
export function growthbookComposedError(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Error {
  let message = "";
  for (let i = 0; i < strings.length; i++) {
    message += strings[i];
    if (i < values.length) {
      message += String(values[i]);
    }
  }

  const pattern = strings.reduce((acc, segment, index) => {
    const hole = index < values.length ? "{}" : "";
    return acc + segment + hole;
  }, "");

  const err = new Error(message.trim());
  Reflect.set(err, GROWTHBOOK_COMPOSED_ERROR_PATTERN, pattern);
  return err;
}

/**
 * Collapse `{...}` segments (e.g. JSON payloads) innermost-first so dynamic
 * object bodies do not split fingerprints. No-op when braces are absent.
 */
export function collapseBraceSegments(message: string): string {
  if (!message.includes("{") || !message.includes("}")) {
    return message;
  }
  let normalized = message;
  for (let pass = 0; pass < 64; pass++) {
    const start = normalized.indexOf("{");
    if (start < 0) {
      break;
    }
    let depth = 0;
    let end = -1;
    for (let i = start; i < normalized.length; i++) {
      const ch = normalized[i];
      if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) {
      break;
    }
    const inner = normalized.slice(start + 1, end);
    if (!inner.length) {
      break;
    }
    normalized = normalized.slice(0, start) + "{}" + normalized.slice(end + 1);
  }
  return normalized;
}

/**
 * Normalize volatile fragments in error messages for stable issue grouping.
 *
 * Inspired by Sentry's server-side message parameterization (see
 * `sentry/grouping/parameterization.py`): replace emails, URLs, IDs, dates,
 * etc. with placeholders. Unlike Sentry, we also fold stack frames into the
 * fingerprint client-side; Sentry primarily groups on stack when available.
 */
export function normalizeErrorMessageForFingerprint(message: string): string {
  let normalized = message.trim();
  normalized = collapseBraceSegments(normalized);

  // W3C traceparent / AWS ALB trace ids
  normalized = normalized.replace(
    /\b00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]\b/gi,
    "{trace}",
  );
  normalized = normalized.replace(
    /\b1-[0-9a-f]{8}-[0-9a-f]{24}\b/gi,
    "{trace}",
  );

  normalized = normalized.replace(
    /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+/g,
    "{email}",
  );
  normalized = normalized.replace(/https?:\/\/\S+/gi, "{url}");
  normalized = normalized.replace(/\bwww\.\S+/gi, "{url}");

  normalized = normalized.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,
    "{uuid}",
  );

  // Distinct hash lengths before generic hex (Sentry: sha1 / md5)
  normalized = normalized.replace(/\b[0-9a-f]{40}\b/gi, "{sha1}");
  normalized = normalized.replace(/\b[0-9a-f]{32}\b/gi, "{md5}");

  normalized = normalized.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "{ip}");

  normalized = normalized.replace(
    /\d{4}-[01]\d-[0-3]\d(?:[T\s][0-2]\d:[0-5]\d(?::[0-5]\d)?(?:\.\d+)?(?:Z|[+-][0-2]\d:?[0-5]\d)?)?/g,
    "{datetime}",
  );

  normalized = normalized.replace(/"[^"]{3,}"/g, "{str}");
  normalized = normalized.replace(/'[^']{3,}'/g, "{str}");

  normalized = normalized.replace(
    /(?:\/?[\w.-]+)+\.(?:tsx?|jsx?|mjs|cjs|vue|py|go|rb|java|cs|php|rs)\b/gi,
    "{path}",
  );

  normalized = normalized.replace(/\b0x[0-9a-f]+\b/gi, "{hex}");
  normalized = normalized.replace(
    /\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*[0-9])[0-9a-f]{8,}\b/gi,
    "{hex}",
  );

  normalized = normalized.replace(/\btx[0-9a-f]{21}-[0-9a-f]{10}\S*/gi, "{id}");

  // Mixed alphanumeric tokens (request ids, base64-ish chunks, etc.)
  normalized = normalized.replace(
    /\b(?=[\w-]*[a-zA-Z])(?=[\w-]*[0-9])[\w-]{8,}\b/g,
    "{id}",
  );

  normalized = normalized.replace(/\b\d+(\.\d+)?ms\b/gi, "{duration}");
  normalized = normalized.replace(/\b-?\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g, "{n}");
  normalized = normalized.replace(/\b-?\d+\.\d+\b/g, "{n}");
  normalized = normalized.replace(/\b-?\d+\b/g, "{n}");
  normalized = normalized.replace(/\s+/g, " ");
  return normalized;
}

/** Reduce bundled or absolute paths to a stable app-relative label. */
export function normalizeFilenameForFingerprint(filename: string): string {
  let normalized = filename.trim();
  normalized = normalized.replace(/^webpack-internal:\/\/\/+/, "");
  normalized = normalized.replace(/^\(app-pages-browser\)\/+/, "");
  normalized = normalized.replace(/^https?:\/\/[^/]+\/+/, "");
  normalized = normalized.replace(/\?.*$/, "");
  normalized = normalized.replace(/:\d+(?::\d+)?$/, "");

  const parts = normalized.split(/[/\\]/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }
  return parts[parts.length - 1] || normalized;
}

function isNoiseFrame(frame: ErrorTrackingStackFrame): boolean {
  const file = frame.filename || "";
  return NOISE_FRAME_PATH_RE.test(file) || /^webpack/i.test(file);
}

function formatFrameForFingerprint(frame: ErrorTrackingStackFrame): string {
  const file = frame.filename
    ? normalizeFilenameForFingerprint(frame.filename)
    : "?";
  const fn = frame.function?.trim();
  const fnLabel = fn && !/^(?:anonymous|unknown)$/i.test(fn) ? fn : "?";
  return `${fnLabel}@${file}`;
}

function selectFingerprintFrames(
  frames: ErrorTrackingStackFrame[],
): ErrorTrackingStackFrame[] {
  const appFrames = frames.filter((frame) => !isNoiseFrame(frame));
  const candidates = appFrames.length ? appFrames : frames;
  const selected: ErrorTrackingStackFrame[] = [];
  const seen = new Set<string>();

  for (const frame of candidates) {
    const label = formatFrameForFingerprint(frame);
    if (seen.has(label)) {
      continue;
    }
    seen.add(label);
    selected.push(frame);
    if (selected.length >= FINGERPRINT_FRAME_LIMIT) {
      break;
    }
  }

  return selected;
}

/**
 * Stable issue grouping key from error type, normalized message, and
 * application stack frames (without line/column numbers).
 */
export function fingerprintForError(
  message: string,
  stack?: string,
  errorName?: string,
  messageForFingerprint?: string,
): string {
  const frames = parseStackFrames(stack);
  const selectedFrames = selectFingerprintFrames(frames);
  const fingerprintMessage = messageForFingerprint ?? message;
  const parts = [
    errorName?.trim() || "Error",
    normalizeErrorMessageForFingerprint(fingerprintMessage),
    ...selectedFrames.map(formatFrameForFingerprint),
  ];

  return hashFingerprintParts(parts);
}

export type BuiltErrorEventProps = {
  fingerprint: string;
  /** Human-readable issue line; same as {@link BuiltErrorEventProps.message}. */
  title: string;
  /** Full interpolated `Error.message` (for UI / warehouse; fingerprint may use a static pattern). */
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
): BuiltErrorEventProps & Record<string, unknown> {
  const { message, stack, name } = stringifyUnknown(error);
  const stackFrames = parseStackFrames(stack);
  const composedPattern = getComposedErrorPattern(error);
  const fingerprint = fingerprintForError(
    message,
    stack,
    name,
    composedPattern,
  );

  const {
    errorType,
    transaction,
    release,
    runtime,
    tags,
    contexts,
    breadcrumbs,
    handled,
    title: _extrasTitle,
    fingerprint: _extrasFingerprint,
    message: _extrasMessage,
    ...rest
  } = extras || {};

  const displayMessage =
    message.length > 500 ? `${message.slice(0, 497)}...` : message;

  return {
    ...rest,
    fingerprint,
    title: displayMessage,
    message: displayMessage,
    errorType: typeof errorType === "string" ? errorType : "unknown",
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
}

async function logError(
  gb: GrowthBook | UserScopedGrowthBook | GrowthBookClient,
  error: unknown,
  extras?: Record<string, unknown>,
) {
  const props = buildErrorEventProperties(error, extras);
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
      screen:
        typeof screen !== "undefined" ? `${screen.width}x${screen.height}` : "",
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
  /** Skip logging when the same fingerprint was reported very recently. */
  dedupeWindowMs?: number;
  /** e.g. git SHA or app version — also appears in event tags. */
  release?: string;
  /** Resolve release at capture time (overrides static `release`). */
  getRelease?: () => string | undefined;
  runtime?: string;
  /** Optional transaction name (e.g. React route). */
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

    const recentFingerprints = new Map<string, number>();
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

      const propsPreview = buildErrorEventProperties(error, extras);
      const fp = propsPreview.fingerprint;
      const now = Date.now();
      const last = recentFingerprints.get(fp);
      if (last !== undefined && now - last < dedupeWindowMs) {
        return;
      }
      recentFingerprints.set(fp, now);

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
        runtime:
          extras?.runtime ?? runtime ?? (browser ? "browser" : "javascript"),
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
