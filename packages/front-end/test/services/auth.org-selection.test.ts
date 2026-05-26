import {
  getNextOrgIdForOrganizationsUpdate,
  getUrlOrgId,
} from "@/services/auth";

describe("auth org selection helpers", () => {
  describe("getUrlOrgId", () => {
    it("returns router query org when present", () => {
      expect(getUrlOrgId("org_from_router")).toBe("org_from_router");
    });

    it("returns first non-empty array value from router query", () => {
      expect(getUrlOrgId(["", "org_from_array"])).toBe("org_from_array");
    });

    it("falls back to window location search when router query missing", () => {
      const originalLocation = window.location;
      Object.defineProperty(window, "location", {
        writable: true,
        value: new URL("http://localhost:3000/features?org=org_from_url"),
      });

      try {
        expect(getUrlOrgId(undefined)).toBe("org_from_url");
      } finally {
        Object.defineProperty(window, "location", {
          writable: true,
          value: originalLocation,
        });
      }
    });
  });

  describe("getNextOrgIdForOrganizationsUpdate", () => {
    const orgs = [
      { id: "org_a", name: "Org A" },
      { id: "org_b", name: "Org B" },
    ];

    it("prioritizes requested org from URL when valid", () => {
      const next = getNextOrgIdForOrganizationsUpdate({
        requestedOrgId: "org_b",
        orgs,
        currentOrgId: "org_a",
        specialOrgId: undefined,
        superAdmin: false,
        pickedOrgId: "org_a",
      });

      expect(next).toBe("org_b");
    });

    it("does not change org when current org is already valid", () => {
      const next = getNextOrgIdForOrganizationsUpdate({
        requestedOrgId: null,
        orgs,
        currentOrgId: "org_a",
        specialOrgId: undefined,
        superAdmin: false,
        pickedOrgId: "org_b",
      });

      expect(next).toBeUndefined();
    });

    it("ignores picked org when explicit requested org is present but invalid", () => {
      const next = getNextOrgIdForOrganizationsUpdate({
        requestedOrgId: "org_missing",
        orgs,
        currentOrgId: null,
        specialOrgId: undefined,
        superAdmin: false,
        pickedOrgId: "org_b",
      });

      expect(next).toBe("org_a");
    });

    it("uses picked org when no requested org and picked org is valid", () => {
      const next = getNextOrgIdForOrganizationsUpdate({
        requestedOrgId: null,
        orgs,
        currentOrgId: null,
        specialOrgId: undefined,
        superAdmin: false,
        pickedOrgId: "org_b",
      });

      expect(next).toBe("org_b");
    });
  });
});
