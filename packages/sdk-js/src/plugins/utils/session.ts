import { createPersistedEphemeralId } from "./persisted-id";
import { getLocalStorage } from "./storage";

export const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_DURATION_MS = 60 * 60 * 1000;

export type SessionConfig = {
  // Inactivity window (ms); each read refreshes it. Defaults to 10 minutes.
  idleTimeout?: number;
  // Hard cap (ms) from creation, regardless of activity. Defaults to 1 hour.
  maxDuration?: number;
};

// Module-level so every consumer touches the session with the same expiry
// policy; set once by auto-attributes
let sessionConfig: SessionConfig = {};

export function configureSession(config: SessionConfig): void {
  sessionConfig = { ...config };
}

// Cross-tab activity session: localStorage-backed so one sitting spans tabs
// and reloads
const session = createPersistedEphemeralId({
  key: "gb_session_id",
  idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
  maxDurationMs: DEFAULT_MAX_DURATION_MS,
  storage: getLocalStorage,
});

export function getOrCreateSessionId(options?: { forceNew?: boolean }): string {
  return session.getOrCreate({
    forceNew: options ? options.forceNew : undefined,
    idleTimeoutMs: sessionConfig.idleTimeout,
    maxDurationMs: sessionConfig.maxDuration,
  });
}

// The session precedence rule, used by every payload that carries a session
// id: BYO `session_id`, else the live browser session (reading it counts as
// activity), else the projected `sessionId` attribute on the server
export function resolveSessionId(
  attributes: Record<string, unknown>,
): string | null {
  const byo = attributes.session_id;
  if (typeof byo === "string" && byo) return byo;

  if (typeof window !== "undefined") return getOrCreateSessionId();

  const projected = attributes.sessionId;
  return typeof projected === "string" && projected ? projected : null;
}

export function _resetSessionForTests(): void {
  session.reset();
  sessionConfig = {};
}
