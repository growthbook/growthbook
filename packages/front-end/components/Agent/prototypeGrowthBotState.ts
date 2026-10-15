import { useEffect, useSyncExternalStore } from "react";
import { isPrototype } from "@/services/env";

// PROTOTYPE ONLY (set in review). Which state the header's GrowthBot button
// demos, with NEXT_PUBLIC_PROTOTYPE=true (pages/api/init.ts). Not wired to
// real plan or usage data:
//   default  - as built: opens the AI Assistant drawer
//   disabled - GrowthBot is turned off for the org, or not set up
//   limit    - the user has used up their AI usage; "Can upgrade" picks
//              whether they're offered an upgrade or told to ask an admin
//
// Chosen in the prototype panel (PrototypeControls.tsx) or with a URL
// param, ?growthbotState=default|disabled|limit (and optionally
// &growthbotCanUpgrade=true|false). Kept in this browser (localStorage)
// across reloads until reset. With the flag off it's always default.

export type GrowthBotState = "default" | "disabled" | "limit";

export const GROWTHBOT_STATES: { value: GrowthBotState; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "disabled", label: "Disabled" },
  { value: "limit", label: "Limit reached" },
];

const STATE_KEY = "gb-prototype-growthbot-state";
const CAN_UPGRADE_KEY = "gb-prototype-growthbot-can-upgrade";
const CHANGE_EVENT = "gb-prototype-growthbot-change";

function isGrowthBotState(value: unknown): value is GrowthBotState {
  return value === "default" || value === "disabled" || value === "limit";
}

function readState(): GrowthBotState {
  try {
    const value = localStorage.getItem(STATE_KEY);
    return isGrowthBotState(value) ? value : "default";
  } catch (e) {
    return "default";
  }
}

// On unless turned off, so the upgrade path is what demos show first.
function readCanUpgrade(): boolean {
  try {
    return localStorage.getItem(CAN_UPGRADE_KEY) !== "false";
  } catch (e) {
    return true;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (e) {
    // Storage blocked: the choice lasts until the page reloads.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function setGrowthBotState(state: GrowthBotState) {
  write(STATE_KEY, state);
}

export function setGrowthBotCanUpgrade(canUpgrade: boolean) {
  write(CAN_UPGRADE_KEY, canUpgrade ? "true" : "false");
}

// Back to Default, with "Can upgrade" on.
export function resetGrowthBotPrototype() {
  write(STATE_KEY, null);
  write(CAN_UPGRADE_KEY, null);
}

// The URL params, applied (and remembered) once per page load.
let urlApplied = false;
function applyUrlParams() {
  if (urlApplied) return;
  urlApplied = true;
  const params = new URLSearchParams(window.location.search);
  const state = params.get("growthbotState");
  // "limit-reached" too, as the panel labels it.
  const normalized = state === "limit-reached" ? "limit" : state;
  if (isGrowthBotState(normalized)) setGrowthBotState(normalized);
  const canUpgrade = params.get("growthbotCanUpgrade");
  if (canUpgrade === "true" || canUpgrade === "false") {
    setGrowthBotCanUpgrade(canUpgrade === "true");
  }
}

export function useGrowthBotPrototype(): {
  enabled: boolean;
  state: GrowthBotState;
  canUpgrade: boolean;
} {
  const enabled = isPrototype();
  useEffect(() => {
    if (enabled) applyUrlParams();
  }, [enabled]);
  const state = useSyncExternalStore<GrowthBotState>(
    subscribe,
    readState,
    () => "default",
  );
  const canUpgrade = useSyncExternalStore(
    subscribe,
    readCanUpgrade,
    () => true,
  );
  if (!enabled) return { enabled, state: "default", canUpgrade: true };
  return { enabled, state, canUpgrade };
}

// When the usage resets, for the copy: the first of next month.
export function growthBotResetDate(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString(
    undefined,
    { month: "short", day: "numeric" },
  );
}
