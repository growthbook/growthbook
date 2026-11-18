import Cookies from "js-cookie";

// Per browser, not per user: the first person to dismiss it on a shared
// browser dismisses it for the next.
export const NAV_INTRO_COOKIE = "gb_nav_intro_dismissed";
// Chrome caps a cookie's lifetime at 400 days, so this is "forever".
const TTL_DAYS = 400;

export function hasDismissedNavIntro(): boolean {
  return Cookies.get(NAV_INTRO_COOKIE) !== undefined;
}

export function dismissNavIntro(): void {
  Cookies.set(NAV_INTRO_COOKIE, "1", {
    expires: TTL_DAYS,
    path: "/",
    sameSite: "lax",
  });
}
