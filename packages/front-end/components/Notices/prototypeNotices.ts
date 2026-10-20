import { useSyncExternalStore } from "react";
import { SdkPayloadSizeAlert } from "shared/validators";
import { OrganizationUsage } from "shared/types/organization";
import { useUser } from "@/services/UserContext";
import { clearDismissedNotices } from "./headerNotices";

// PROTOTYPE ONLY (set in review): the header notices' demo data, chosen in
// the prototype panel's "Header notices" section (PrototypeControls.tsx)
// and kept in this browser (localStorage). For each notice switched on,
// its hook (useAccountPlanNotices, usePayloadSizeNotices,
// useKeyExpiryNotices) reads fake inputs from here in place of the real
// ones, so the notices go through production's own titles and ranking,
// then the header's banner, notices list and trial chip (headerNotices.ts). Nothing reads or changes real plan data; a notice
// left off uses the real data as before.

export type UsageNoticeState = "off" | "approaching" | "over";
export type PayloadNoticeState = "off" | "nearing" | "over";
export type KeyNoticeState = "off" | "expiring" | "expired";

// The license slot: production shows one at a time, the first that applies,
// so this is one choice.
export const LICENSE_NOTICE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "message", label: "Server-sent license message" },
  { value: "error", label: "License error (server unreachable)" },
  { value: "expired-pro", label: "License expired (Pro)" },
  { value: "expired-enterprise", label: "License expired (Enterprise)" },
  { value: "email", label: "Email not verified" },
  { value: "server-down", label: "License server down (cached)" },
  // The trial chip's states (set in review; was one, "Trial ending").
  { value: "trial", label: "Trial, Pro (12 days left)" },
  { value: "trial-ending", label: "Trial, Pro (last 3 days)" },
  { value: "trial-enterprise", label: "Trial, Enterprise (12 days left)" },
  { value: "seats", label: "Seat quota exceeded" },
] as const;
export type LicenseNoticeState =
  (typeof LICENSE_NOTICE_OPTIONS)[number]["value"];

export type PrototypeNotices = {
  cdn: UsageNoticeState;
  warehouse: UsageNoticeState;
  license: LicenseNoticeState;
  payload: PayloadNoticeState;
  pat: KeyNoticeState;
  apiKey: KeyNoticeState;
};

const DEFAULTS: PrototypeNotices = {
  cdn: "off",
  warehouse: "off",
  license: "none",
  payload: "off",
  pat: "off",
  apiKey: "off",
};

const STORAGE_KEY = "gb-prototype-header-notices";
const CHANGE_EVENT = "gb-prototype-header-notices-change";

let cached: { raw: string | null; value: PrototypeNotices } | null = null;

function read(): PrototypeNotices {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    // Storage blocked: the defaults.
  }
  if (cached && cached.raw === raw) return cached.value;
  let value = DEFAULTS;
  try {
    value = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch (e) {
    value = DEFAULTS;
  }
  cached = { raw, value };
  return value;
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function usePrototypeNotices(): PrototypeNotices {
  return useSyncExternalStore(subscribe, read, () => DEFAULTS);
}

export function setPrototypeNotice<K extends keyof PrototypeNotices>(
  key: K,
  value: PrototypeNotices[K],
) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...read(), [key]: value }),
    );
  } catch (e) {
    // Storage blocked: nothing to change.
  }
  // Dismissed warnings back, so what's switched on shows.
  clearDismissedNotices();
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// All off (the panel's Reset to defaults).
export function resetPrototypeNotices() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    // Storage blocked: nothing saved to clear.
  }
  clearDismissedNotices();
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// ---------------------------------------------------------------------------
// Fake inputs
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const fromNow = (days: number) => new Date(Date.now() + days * DAY);

type User = ReturnType<typeof useUser>;
type AccountPlanInputs = Pick<
  User,
  "usage" | "license" | "licenseError" | "seatsInUse"
>;

// useAccountPlanNotices' inputs: the real ones, with the usage statuses
// and the license slot replaced where the panel switches them on.
export function useAccountPlanNoticeInputs(): AccountPlanInputs {
  const { usage, license, licenseError, seatsInUse } = useUser();
  const notices = usePrototypeNotices();
  const real: AccountPlanInputs = { usage, license, licenseError, seatsInUse };

  let inputs = real;
  if (notices.cdn !== "off" || notices.warehouse !== "off") {
    const base: OrganizationUsage = usage ?? {
      limits: { requests: "unlimited", bandwidth: "unlimited" },
      cdn: { lastUpdated: new Date(), status: "under" },
    };
    inputs = {
      ...inputs,
      usage: {
        ...base,
        cdn:
          notices.cdn !== "off"
            ? { lastUpdated: new Date(), status: notices.cdn }
            : base.cdn,
        managedClickhouse:
          notices.warehouse !== "off"
            ? { lastUpdated: new Date(), status: notices.warehouse }
            : base.managedClickhouse,
      },
    };
  }
  if (notices.license !== "none") {
    inputs = { ...inputs, ...fakeLicense(notices.license) };
  }
  return inputs;
}

function fakeLicense(
  state: Exclude<LicenseNoticeState, "none">,
): Pick<AccountPlanInputs, "license" | "licenseError" | "seatsInUse"> {
  switch (state) {
    case "message":
      return {
        license: {
          plan: "enterprise",
          message: {
            text: "Your license renews soon",
            className: "",
            tooltipText:
              "Your license is up for renewal at the end of the month. Contact sales@growthbook.io with any questions.",
            showAllUsers: true,
          },
        },
        licenseError: "",
        seatsInUse: 0,
      };
    case "error":
      return {
        license: { plan: "pro" },
        licenseError: "License server unreachable for too long",
        seatsInUse: 0,
      };
    case "expired-pro":
      return {
        license: { plan: "pro", dateExpires: fromNow(-5).toISOString() },
        licenseError: "License expired",
        seatsInUse: 0,
      };
    case "expired-enterprise":
      return {
        license: { plan: "enterprise", dateExpires: fromNow(-5).toISOString() },
        licenseError: "License expired",
        seatsInUse: 0,
      };
    case "email":
      return {
        license: { plan: "pro", isTrial: true, email: "you@example.com" },
        licenseError: "Email not verified",
        seatsInUse: 0,
      };
    case "server-down":
      return {
        license: {
          plan: "enterprise",
          usingMongoCache: true,
          firstFailedFetchDate: fromNow(-3),
          lastFailedFetchDate: new Date(),
          lastServerErrorMessage: "Could not connect to the license server",
        },
        licenseError: "",
        seatsInUse: 0,
      };
    case "trial":
    case "trial-ending":
    case "trial-enterprise":
      return {
        license: {
          plan: state === "trial-enterprise" ? "enterprise" : "pro",
          isTrial: true,
          // Half a day over, so daysLeft's rounding gives 12 and 2.
          dateExpires: fromNow(
            state === "trial-ending" ? 2.5 : 12.5,
          ).toISOString(),
        },
        licenseError: "",
        seatsInUse: 0,
      };
    case "seats":
      return {
        license: { plan: "enterprise", seats: 10 },
        licenseError: "",
        seatsInUse: 12,
      };
  }
}

const MB = 1024 * 1024;

// usePayloadSizeNotices' input: the real alerts, or two fake connections,
// both nearing the limit, or one over it and one nearing it.
export function usePayloadSizeAlertsInput(): SdkPayloadSizeAlert[] {
  const { sdkPayloadSizeAlerts } = useUser();
  const { payload } = usePrototypeNotices();
  if (payload === "off") return sdkPayloadSizeAlerts;
  const alert = (
    connectionId: string,
    connectionName: string,
    level: SdkPayloadSizeAlert["level"],
    share: number,
  ): SdkPayloadSizeAlert => ({
    connectionId,
    connectionName,
    level,
    bytes: Math.round(16 * MB * share),
    limitBytes: 16 * MB,
    recommendations: [{ type: "archive-stale-features" }],
  });
  return payload === "over"
    ? [
        alert("sdk_web", "Web app", "over-limit", 1.05),
        alert("sdk_ios", "iOS app", "warning", 0.6),
      ]
    : [
        alert("sdk_web", "Web app", "warning", 0.6),
        alert("sdk_ios", "iOS app", "warning", 0.55),
      ];
}

export type ExpiringKey = {
  id: string;
  description: string;
  expiresAt: Date;
  lastUsed: Date;
};

// useKeyExpiryNotices' inputs. On main they come from useUser
// (expiringPersonalAccessTokens, expiringApiKeys), which this branch
// predates, so here they're the panel's fakes only: one key expiring in
// 5 days, or one that expired 2 days ago but was used an hour ago (and,
// for API keys, a second still expiring).
export function useExpiringKeysInput(): {
  personalAccessTokens: ExpiringKey[];
  apiKeys: ExpiringKey[];
} {
  const { pat, apiKey } = usePrototypeNotices();
  const expiring = (id: string, description: string): ExpiringKey => ({
    id,
    description,
    expiresAt: fromNow(5),
    lastUsed: fromNow(-1),
  });
  const expired = (id: string, description: string): ExpiringKey => ({
    id,
    description,
    expiresAt: fromNow(-2),
    lastUsed: new Date(Date.now() - 60 * 60 * 1000),
  });
  return {
    personalAccessTokens:
      pat === "off"
        ? []
        : pat === "expiring"
          ? [expiring("pat_1", "CI deploy token")]
          : [expired("pat_1", "CI deploy token")],
    apiKeys:
      apiKey === "off"
        ? []
        : apiKey === "expiring"
          ? [
              expiring("key_1", "Production backend"),
              expiring("key_2", "Staging backend"),
            ]
          : [
              expired("key_1", "Production backend"),
              expiring("key_2", "Staging backend"),
            ],
  };
}
