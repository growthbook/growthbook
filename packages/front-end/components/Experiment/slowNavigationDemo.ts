// ─────────────────────────────────────────────────────────────────────────
// PROTOTYPE DEMO: a fake slow page load, to review the route progress bar
// in the local dev prototype, where real slowness (React's dev build
// rendering the page) freezes the screen and can't show it. NOT REAL.
//
// Opening the last experiment on the experiments list's last page waits
// FAKE_SLOW_NAVIGATION_MS before navigating, with the progress bar sweeping
// along the top meanwhile, as a slow load would look in production. Dev
// builds only (isDevelopmentEnvironment).
//
// To turn it off, set FAKE_SLOW_LAST_EXPERIMENT to false. To remove it,
// delete this file and its use in ExperimentsListTable.tsx.
// ─────────────────────────────────────────────────────────────────────────
import { isDevelopmentEnvironment } from "@/services/env";

export const FAKE_SLOW_LAST_EXPERIMENT = true;
export const FAKE_SLOW_NAVIGATION_MS = 1500;

// Starts the route progress bar (RouteProgressBar in pages/_app.tsx), which
// the real page change then stops when it completes.
export const ROUTE_PROGRESS_START_EVENT = "route-progress-start";

export function fakeSlowNavigationEnabled(): boolean {
  return FAKE_SLOW_LAST_EXPERIMENT && isDevelopmentEnvironment();
}

export function fakeSlowNavigation(navigate: () => void): void {
  window.dispatchEvent(new Event(ROUTE_PROGRESS_START_EVENT));
  window.setTimeout(navigate, FAKE_SLOW_NAVIGATION_MS);
}
