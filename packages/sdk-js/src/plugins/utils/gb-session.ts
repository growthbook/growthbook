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

// Module-level so every consumer touches the session with the same expiry
// policy; set once by auto-attributes
let sessionConfig: GbSessionConfig = {};

export function configureGbSession(config: GbSessionConfig): void {
  sessionConfig = { ...config };
}

// Cross-tab activity session: localStorage-backed so one sitting spans tabs
// and reloads
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

// The one place the session precedence rule lives; every payload carrying a
// session id resolves through here so consumers can't disagree. BYO
// `session_id` wins; in the browser the live session is read (which counts
// as activity and keeps it alive); the projected `sessionId` attribute is
// the server-side fallback — a server never mints a process-wide session.
export function resolveSessionId(
  attributes: Record<string, unknown>,
): string | null {
  const byo = attributes.session_id;
  if (typeof byo === "string" && byo) return byo;

  if (typeof window !== "undefined") return getOrCreateGbSessionId();

  const projected = attributes.sessionId;
  return typeof projected === "string" && projected ? projected : null;
}

export function _resetGbSessionForTests(): void {
  gbSession.reset();
  sessionConfig = {};
}
