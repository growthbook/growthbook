import { getOrgSwitchRedirectPath } from "@/services/orgSwitchRedirect";

describe("getOrgSwitchRedirectPath", () => {
  describe("known dynamic resource pages", () => {
    it.each([
      ["/experiment/[eid]", "/experiments"],
      ["/bandit/[bid]", "/bandits"],
      ["/holdout/[hid]", "/holdouts"],
      ["/feature/[fid]", "/features"],
      ["/metric/[mid]", "/metrics"],
      ["/fact-metrics/[fmid]", "/fact-metrics"],
      ["/fact-tables/[ftid]", "/fact-tables"],
      ["/sql-explorer/[id]", "/sql-explorer"],
      ["/idea/[iid]", "/ideas"],
      ["/report/[rid]", "/reports"],
      ["/project/[pid]", "/projects"],
      ["/datasources/[did]", "/datasources"],
      ["/settings/team/[tid]", "/settings/team"],
    ])("redirects %s to %s", (pathname, expected) => {
      expect(getOrgSwitchRedirectPath(pathname)).toBe(expected);
    });
  });

  describe("unmapped dynamic routes", () => {
    it("falls back to / for any unknown dynamic route", () => {
      expect(getOrgSwitchRedirectPath("/some/unknown/[id]")).toBe("/");
    });
  });

  describe("static (org-agnostic) pages", () => {
    it.each([
      "/",
      "/experiments",
      "/features",
      "/dashboard",
      "/settings/team",
      "/admin",
    ])("returns null for %s", (pathname) => {
      expect(getOrgSwitchRedirectPath(pathname)).toBeNull();
    });
  });
});
