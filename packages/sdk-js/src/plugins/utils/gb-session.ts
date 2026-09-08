import { createPersistedEphemeralId } from "./persisted-id";
import { getLocalStorage } from "./storage";

export const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_DURATION_MS = 60 * 60 * 1000;

export type GbSessionConfig = {
  // Inactivity window (ms); each read refreshes it. Defaults to 10 minutes.
  idleTimeout?: number;
  // Hard cap (ms) from creation, regardless of activity. Defaults to 1 hour.
  maxDuration?: number;
};

// Session config is module-level so every consumer (auto-attributes,
// session replay, the tracking plugin) touches the session with the same
// expiry policy. Set once, by whichever plugin the user configures.
let sessionConfig: GbSessionConfig = {};

export function configureGbSession(config: GbSessionConfig): void {
  sessionConfig = { ...config };
}

// Cross-tab activity session (APM-style): localStorage-backed so one sitting
// spans tabs and reloads. Rotates after idleTimeout of inactivity (each read
// refreshes the window), with maxDuration as a hard cap from creation.
const gbSession = createPersistedEphemeralId({
  key: "gb_session_id",
  idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
  maxDurationMs: DEFAULT_MAX_DURATION_MS,
  storage: getLocalStorage,
});

export function getOrCreateGbSessionId(options?: {
  forceNew?: boolean;
}): string {
  return gbSession.getOrCreate({
    forceNew: options?.forceNew,
    idleTimeoutMs: sessionConfig.idleTimeout,
    maxDurationMs: sessionConfig.maxDuration,
  });
}

/**
 * The one place the session precedence rule lives. Every payload that
 * carries a session id must resolve it through here so the events column,
 * replay chunks, and future consumers can never disagree:
 *
 *   1. `session_id` — a customer-supplied session always wins
 *   2. `sessionId` — the GB session already projected into attributes
 *   3. mint — browser only; on the server a session comes from customer
 *      attributes or propagated request context, never a process-wide mint
 */
export function resolveSessionId(
  attributes: Record<string, unknown>,
): string | null {
  const byo = attributes.session_id;
  if (typeof byo === "string" && byo) return byo;

  const projected = attributes.sessionId;
  if (typeof projected === "string" && projected) return projected;

  if (typeof window === "undefined") return null;
  return getOrCreateGbSessionId();
}

export function _resetGbSessionForTests(): void {
  gbSession.reset();
  sessionConfig = {};
}
