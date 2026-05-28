// Map of dynamic resource pages (Next.js `pathname`) to a safe list-view
// path to redirect to when the active organization changes. Without this
// redirect, the page would attempt to load a resource that does not exist
// in the newly selected organization and surface a generic load error
// (e.g. "There was a problem loading the experiment").
const DYNAMIC_ROUTE_REDIRECTS: Record<string, string> = {
  "/experiment/[eid]": "/experiments",
  "/bandit/[bid]": "/bandits",
  "/holdout/[hid]": "/holdouts",
  "/feature/[fid]": "/features",
  "/metric/[mid]": "/metrics",
  "/fact-metrics/[fmid]": "/fact-metrics",
  "/fact-tables/[ftid]": "/fact-tables",
  "/sql-explorer/[id]": "/sql-explorer",
  "/idea/[iid]": "/ideas",
  "/sdks/[sdkid]": "/sdks",
  "/saved-groups/[sgid]": "/saved-groups",
  "/metric-groups/[mgid]": "/metrics",
  "/datasources/[did]": "/datasources",
  "/datasources/queries/[did]": "/datasources",
  "/report/[rid]": "/reports",
  "/project/[pid]": "/projects",
  "/product-analytics/dashboards/[did]": "/product-analytics/dashboards",
  "/experiments/template/[tid]": "/experiments/templates",
  "/experiments/import/[id]": "/experiments",
  "/attributes/[property]": "/attributes",
  "/events/[eventid]": "/events",
  "/settings/role/[rid]": "/settings/team",
  "/settings/role/duplicate/[rid]": "/settings/team",
  "/settings/team/[tid]": "/settings/team",
  "/settings/webhooks/event/[eventwebhookid]": "/settings/webhooks",
  "/present/[pid]": "/presentations",
};

// Returns the path to redirect to when the active organization changes
// while the user is on the given Next.js `pathname`, or `null` if the
// current page is org-agnostic and no redirect is necessary.
export function getOrgSwitchRedirectPath(pathname: string): string | null {
  if (pathname in DYNAMIC_ROUTE_REDIRECTS) {
    return DYNAMIC_ROUTE_REDIRECTS[pathname];
  }

  // Fallback: any other dynamic route (one containing a `[param]` segment)
  // is assumed to load org-scoped data and should send the user back to the
  // home page after an org switch.
  if (pathname.includes("[")) {
    return "/";
  }

  return null;
}
