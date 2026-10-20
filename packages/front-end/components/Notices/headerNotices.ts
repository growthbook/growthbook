import { useSyncExternalStore } from "react";
import { AppNotice, rankNotices } from "./notices";

// PROTOTYPE (set in review): the header's three notice treatments, each
// fed by the existing notices (useAccountPlanNotices, usePayloadSizeNotices,
// useKeyExpiryNotices) and their severities:
// - banner: every error, in a full-width banner above the header
//   (NoticeBanner.tsx): the one with the highest precedence (below), the
//   others behind its "+N" chip.
// - list: the warnings, amber, behind a badge left of GrowthBot
//   (NoticeIndicator.tsx); no errors (set in review; expired keys still in
//   use were its red items until they joined the banner).
// - trial: the license slot's trial countdown, counted in neither: its
//   own pill in the header, as the product shows it today (set in review;
//   tried the banner, in violet, and a purple chip).

// Which error gets the banner, highest first (set in review). Change the
// order here. An error matching none comes after all of them.
const BANNER_PRECEDENCE: {
  level: string;
  matches: (notice: AppNotice) => boolean;
}[] = [
  // Affects the whole account: the license invalid, expired or failing,
  // the license server unreachable or erroring, email not verified (and
  // the license server's own message, which can be any of these).
  {
    level: "account",
    matches: (n) => n.id === "license" && n.kind !== "seat-quota",
  },
  // Stops SDKs updating: usage over its limit, the payload over max size.
  {
    level: "sdk-updates",
    matches: (n) =>
      ["cdn-usage", "managed-warehouse-usage", "sdk-payload-size"].includes(
        n.id,
      ),
  },
  // Breaks an integration: a personal access token or API key that's
  // expired but still in use (set in review; were the warnings badge's red
  // items). Below the SDK errors, which affect every SDK; above seat quota,
  // which breaks nothing.
  {
    level: "expired-keys",
    matches: (n) =>
      ["personal-access-token-expiry", "api-key-expiry"].includes(n.id),
  },
  { level: "seat-quota", matches: (n) => n.kind === "seat-quota" },
];

const precedence = (notice: AppNotice) => {
  const i = BANNER_PRECEDENCE.findIndex((p) => p.matches(notice));
  return i === -1 ? BANNER_PRECEDENCE.length : i;
};

export type HeaderNotices = {
  banner: AppNotice | null;
  // The other active errors, by precedence, behind the banner's "+N more"
  // (set in review).
  bannerMore: AppNotice[];
  // Whether the viewer may close the banner (below): only when it's the
  // only error.
  bannerDismissible: boolean;
  list: AppNotice[];
  trial: AppNotice | null;
};

// The banner's close button (set in review): only for people who can't act
// on its error, and never for the license's (the account-wide level),
// which everyone needs to see. Closing hides it until the next session or
// until it changes (its signature, below).
export const isBannerDismissible = (
  notice: AppNotice,
  canAct: (notice: AppNotice) => boolean,
) => {
  return precedence(notice) !== 0 && !canAct(notice);
};

// canAct: whether the person viewing can take a notice's action; within a
// level, the banner goes to one they can. dismissedBanner: the signature of
// the banner the viewer closed this session, if any.
export function routeHeaderNotices(
  notices: AppNotice[],
  canAct: (notice: AppNotice) => boolean = () => false,
  dismissedBanner: string | null = null,
): HeaderNotices {
  const ranked = rankNotices(notices);
  const trial = ranked.find((n) => n.trial) ?? null;
  const contenders = ranked.filter((n) => !n.trial && n.severity === "error");
  // By precedence, then actionable first, then the existing ranking (the
  // sort is stable, and they're ranked already).
  const ordered = [...contenders].sort(
    (a, b) =>
      precedence(a) - precedence(b) || Number(canAct(b)) - Number(canAct(a)),
  );
  const [top = null, ...more] = ordered;
  // The close button only when it's the only error (set in review), so
  // closing never hides others; closed, the top of the page stays clear
  // until it changes, or another error joins it.
  const topDismissible =
    !!top && !more.length && isBannerDismissible(top, canAct);
  const closed = topDismissible && noticeSignature(top) === dismissedBanner;
  return {
    banner: closed ? null : top,
    bannerMore: closed ? [] : more,
    bannerDismissible: !closed && topDismissible,
    list: listOf(ranked),
    trial,
  };
}

// The warnings; no errors.
const listOf = (ranked: AppNotice[]) =>
  ranked.filter((n) => !n.trial && n.severity === "warning");

// A warning stays dismissed until its state changes: its severity or its
// title, which names the state (approaching or over, how many keys).
export const noticeSignature = (notice: AppNotice) =>
  `${notice.severity}:${notice.title}`;

export const isDismissible = (notice: AppNotice) =>
  notice.severity === "warning";

// Dismissals, by notice id, in this browser (localStorage).
const STORAGE_KEY = "gb-prototype-dismissed-notices";
const CHANGE_EVENT = "gb-prototype-dismissed-notices-change";
type Dismissed = Record<string, string>;
const NONE: Dismissed = {};

let cached: { raw: string | null; value: Dismissed } | null = null;

function read(): Dismissed {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    // Storage blocked: nothing dismissed.
  }
  if (cached && cached.raw === raw) return cached.value;
  let value = NONE;
  try {
    value = raw ? JSON.parse(raw) : NONE;
  } catch (e) {
    value = NONE;
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

export function useDismissedNotices(): Dismissed {
  return useSyncExternalStore(subscribe, read, () => NONE);
}

export const isDismissed = (notice: AppNotice, dismissed: Dismissed) =>
  isDismissible(notice) && dismissed[notice.id] === noticeSignature(notice);

export function dismissNotice(notice: AppNotice) {
  if (!isDismissible(notice)) return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...read(), [notice.id]: noticeSignature(notice) }),
    );
  } catch (e) {
    // Storage blocked: it can't stay dismissed.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// Everything back (the prototype panel clears them when its Header notices
// change, and on Reset to defaults, so a reviewer sees what they turn on).
export function clearDismissedNotices() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    // Storage blocked: nothing saved to clear.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  // And a closed banner (PROTOTYPE).
  clearDismissedBanner();
}

// The banner the viewer closed, by signature, for this browser session
// (sessionStorage): gone with the session, and no longer matching once the
// error changes.
const BANNER_KEY = "gb-prototype-dismissed-banner";
const BANNER_EVENT = "gb-prototype-dismissed-banner-change";

function readBanner(): string | null {
  try {
    return sessionStorage.getItem(BANNER_KEY);
  } catch (e) {
    return null;
  }
}

function subscribeBanner(onChange: () => void) {
  window.addEventListener(BANNER_EVENT, onChange);
  return () => window.removeEventListener(BANNER_EVENT, onChange);
}

export function useDismissedBanner(): string | null {
  return useSyncExternalStore(subscribeBanner, readBanner, () => null);
}

export function dismissBanner(notice: AppNotice) {
  try {
    sessionStorage.setItem(BANNER_KEY, noticeSignature(notice));
  } catch (e) {
    // Storage blocked: it can't stay closed.
  }
  window.dispatchEvent(new Event(BANNER_EVENT));
}

function clearDismissedBanner() {
  try {
    sessionStorage.removeItem(BANNER_KEY);
  } catch (e) {
    // Storage blocked: nothing saved to clear.
  }
  window.dispatchEvent(new Event(BANNER_EVENT));
}

// The banner's text as a sentence (set in review): its first letter a
// capital and a full stop at the end, whatever the notice's own casing (some
// license errors come lowercased, and titles have no full stop). Text that
// already ends a sentence keeps its own punctuation.
export function asSentence(text: string) {
  const capitalized = asHeading(text);
  if (!capitalized) return capitalized;
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

// A heading (the popovers' titles): its first letter a capital, no full
// stop added (set in review).
export function asHeading(text: string) {
  const trimmed = text.trim();
  return trimmed ? trimmed[0].toUpperCase() + trimmed.slice(1) : trimmed;
}
