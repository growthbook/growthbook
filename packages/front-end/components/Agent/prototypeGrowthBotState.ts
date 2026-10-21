import { useEffect, useSyncExternalStore } from "react";
import { isPrototype } from "@/services/env";

// PROTOTYPE ONLY (set in review). What the header's GrowthBot button and
// drawer demo, with NEXT_PUBLIC_PROTOTYPE=true (pages/api/init.ts), as
// plans actually work (set in review). Not wired to real plan, usage or
// permission data; they only change what GrowthBot shows:
//   Plan     - Starter (GrowthBot isn't included), Pro or Enterprise
//   Hosting  - GrowthBook Cloud or self-hosted (also, without real build
//              info, whether the Help menu shows its Version row;
//              HelpMenu.tsx; set in review)
//   State    - only those the plan and hosting can really have:
//     default     - as built: opens the AI Assistant drawer
//     not-in-plan - Starter: GrowthBot isn't in the plan
//     limit       - Pro on Cloud: the daily limit (1M tokens) is used up,
//                   until 24 hours after the org's last reset
//     off         - AI is turned off for the org
//     no-key      - self-hosted: AI is on, but no API key is set up
//   Can manage billing & settings - whether the viewer is offered the fix
//     (Upgrade Plan, Contact Sales, Turn On, Set Up), or told to contact
//     their admin
//
// Chosen in the prototype panel (PrototypeControls.tsx) or with URL params:
//   ?growthbotPlan=starter|pro|enterprise
//   &growthbotHosting=cloud|self-hosted
//   &growthbotState=default|not-in-plan|limit|off|no-key
//   &growthbotCanManage=true|false
// (the old growthbotState=disabled and growthbotCanUpgrade still work, as
// off and growthbotCanManage). A state the plan and hosting can't have
// falls back to the first they can. Kept in this browser (localStorage)
// across reloads until reset. With the flag off it's always default.

export type GrowthBotPlan = "starter" | "pro" | "enterprise";
export type GrowthBotHosting = "cloud" | "self-hosted";
export type GrowthBotState =
  | "default"
  | "not-in-plan"
  | "limit"
  | "off"
  | "no-key";

export const GROWTHBOT_PLANS: { value: GrowthBotPlan; label: string }[] = [
  { value: "starter", label: "Starter" },
  { value: "pro", label: "Pro" },
  { value: "enterprise", label: "Enterprise" },
];

export const GROWTHBOT_HOSTINGS: { value: GrowthBotHosting; label: string }[] =
  [
    { value: "cloud", label: "Cloud" },
    { value: "self-hosted", label: "Self-hosted" },
  ];

const STATE_LABELS: Record<GrowthBotState, string> = {
  default: "Default",
  "not-in-plan": "Not in plan",
  limit: "Limit reached",
  off: "AI off",
  "no-key": "No API key",
};

// The states a plan and hosting can really have, in the panel's order.
export function growthBotStatesFor(
  plan: GrowthBotPlan,
  hosting: GrowthBotHosting,
): { value: GrowthBotState; label: string }[] {
  const states: GrowthBotState[] =
    // Starter doesn't include GrowthBot, on Cloud or self-hosted.
    plan === "starter"
      ? ["not-in-plan"]
      : [
          "default",
          // Only Pro on Cloud has a limit; Enterprise and self-hosted don't.
          ...(plan === "pro" && hosting === "cloud" ? ["limit" as const] : []),
          "off",
          // Only self-hosted orgs set up their own API key.
          ...(hosting === "self-hosted" ? ["no-key" as const] : []),
        ];
  return states.map((value) => ({ value, label: STATE_LABELS[value] }));
}

const PLAN_KEY = "gb-prototype-growthbot-plan";
const HOSTING_KEY = "gb-prototype-growthbot-hosting";
const STATE_KEY = "gb-prototype-growthbot-state";
const CAN_MANAGE_KEY = "gb-prototype-growthbot-can-manage";
// Before plans (set in review): "Can upgrade", read as Can manage.
const OLD_CAN_UPGRADE_KEY = "gb-prototype-growthbot-can-upgrade";
const CHANGE_EVENT = "gb-prototype-growthbot-change";

const isPlan = (v: unknown): v is GrowthBotPlan =>
  v === "starter" || v === "pro" || v === "enterprise";
const isHosting = (v: unknown): v is GrowthBotHosting =>
  v === "cloud" || v === "self-hosted";
const isState = (v: unknown): v is GrowthBotState =>
  typeof v === "string" && Object.hasOwn(STATE_LABELS, v);
// The old names: "disabled" is now "off"; "limit-reached" as the panel
// labels it.
const normalizeState = (v: string | null) =>
  v === "disabled" ? "off" : v === "limit-reached" ? "limit" : v;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

// Pro on Cloud by default, as most demos.
const readPlan = (): GrowthBotPlan => {
  const v = read(PLAN_KEY);
  return isPlan(v) ? v : "pro";
};
const readHosting = (): GrowthBotHosting => {
  const v = read(HOSTING_KEY);
  return isHosting(v) ? v : "cloud";
};
const readState = (): GrowthBotState => {
  const v = normalizeState(read(STATE_KEY));
  return isState(v) ? v : "default";
};
// On unless turned off, so the fix is what demos show first.
const readCanManage = (): boolean =>
  (read(CAN_MANAGE_KEY) ?? read(OLD_CAN_UPGRADE_KEY)) !== "false";

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

export function setGrowthBotPlan(plan: GrowthBotPlan) {
  write(PLAN_KEY, plan);
}

export function setGrowthBotHosting(hosting: GrowthBotHosting) {
  write(HOSTING_KEY, hosting);
}

export function setGrowthBotState(state: GrowthBotState) {
  write(STATE_KEY, state);
}

export function setGrowthBotCanManage(canManage: boolean) {
  write(OLD_CAN_UPGRADE_KEY, null);
  write(CAN_MANAGE_KEY, canManage ? "true" : "false");
}

// Back to Pro on Cloud, Default, with Can manage on.
export function resetGrowthBotPrototype() {
  write(PLAN_KEY, null);
  write(HOSTING_KEY, null);
  write(STATE_KEY, null);
  write(CAN_MANAGE_KEY, null);
  write(OLD_CAN_UPGRADE_KEY, null);
}

// The URL params, applied (and remembered) once per page load.
let urlApplied = false;
function applyUrlParams() {
  if (urlApplied) return;
  urlApplied = true;
  const params = new URLSearchParams(window.location.search);
  const plan = params.get("growthbotPlan");
  if (isPlan(plan)) setGrowthBotPlan(plan);
  const hosting = params.get("growthbotHosting");
  if (isHosting(hosting)) setGrowthBotHosting(hosting);
  const state = normalizeState(params.get("growthbotState"));
  if (isState(state)) setGrowthBotState(state);
  const canManage =
    params.get("growthbotCanManage") ?? params.get("growthbotCanUpgrade");
  if (canManage === "true" || canManage === "false") {
    setGrowthBotCanManage(canManage === "true");
  }
}

export function useGrowthBotPrototype(): {
  enabled: boolean;
  plan: GrowthBotPlan;
  hosting: GrowthBotHosting;
  // The state shown: the one chosen, if the plan and hosting can have it,
  // or else the first they can.
  state: GrowthBotState;
  canManage: boolean;
} {
  const enabled = isPrototype();
  useEffect(() => {
    if (enabled) applyUrlParams();
  }, [enabled]);
  const plan = useSyncExternalStore<GrowthBotPlan>(
    subscribe,
    readPlan,
    () => "pro",
  );
  const hosting = useSyncExternalStore<GrowthBotHosting>(
    subscribe,
    readHosting,
    () => "cloud",
  );
  const chosen = useSyncExternalStore<GrowthBotState>(
    subscribe,
    readState,
    () => "default",
  );
  const canManage = useSyncExternalStore(subscribe, readCanManage, () => true);
  if (!enabled) {
    return {
      enabled,
      plan: "pro",
      hosting: "cloud",
      state: "default",
      canManage: true,
    };
  }
  const options = growthBotStatesFor(plan, hosting);
  const state = options.some((o) => o.value === chosen)
    ? chosen
    : options[0].value;
  return { enabled, plan, hosting, state, canManage };
}

// When the daily limit resets (Pro on Cloud): 24 hours after the org's last
// reset, which the app knows exactly. Made up here: the last reset 19 hours
// before this page loaded, so it resets in 5 hours.
const LIMIT_RESETS_AT = Date.now() + 5 * 60 * 60 * 1000;

// "in 5 hours", "in 1 hour", "in 40 minutes": when the limit resets, from
// now. No date, as it's always within a day.
export function growthBotLimitResetsIn(now = Date.now()): string {
  const minutes = Math.max(1, Math.ceil((LIMIT_RESETS_AT - now) / 60000));
  if (minutes < 60) {
    return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const hours = Math.round(minutes / 60);
  return `in ${hours} hour${hours === 1 ? "" : "s"}`;
}
