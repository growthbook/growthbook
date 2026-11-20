import Cookies from "js-cookie";

// Per browser, not per user: the first person to dismiss it on a shared
// browser dismisses it for the next.
export const NAV_INTRO_COOKIE = "gb_nav_intro_dismissed";
// Chrome caps a cookie's lifetime at 400 days, so this is "forever".
const TTL_DAYS = 400;
// Accounts created from this moment on never saw the old navigation.
export const NAV_INTRO_ACCOUNT_CUTOFF = "2026-11-19T00:00:00.000Z";

// An unknown or unreadable date counts as an old account.
export function accountPredatesNewNav(
  accountCreatedAt: string | undefined,
): boolean {
  const created = Date.parse(accountCreatedAt ?? "");
  if (Number.isNaN(created)) return true;
  return created < Date.parse(NAV_INTRO_ACCOUNT_CUTOFF);
}

export function hasDismissedNavIntro(): boolean {
  return Cookies.get(NAV_INTRO_COOKIE) !== undefined;
}

// Whether the intro still opens for this person in this browser.
export function isNavIntroDue(accountCreatedAt: string | undefined): boolean {
  return !hasDismissedNavIntro() && accountPredatesNewNav(accountCreatedAt);
}

export function dismissNavIntro(): void {
  Cookies.set(NAV_INTRO_COOKIE, "1", {
    expires: TTL_DAYS,
    path: "/",
    sameSite: "lax",
  });
}
