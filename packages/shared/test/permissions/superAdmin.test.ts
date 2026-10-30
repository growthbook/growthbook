import {
  canChangeSuperAdmin,
  hasSuperAdminPermission,
  holdsAllSuperAdminPermissions,
  normalizeSuperAdmin,
} from "../../src/permissions/superAdmin";
import { SuperAdmin } from "../../src/validators";

describe("hasSuperAdminPermission", () => {
  it("grants everything to legacy `true`", () => {
    expect(hasSuperAdminPermission(true, "grant")).toBe(true);
    expect(hasSuperAdminPermission(true, "impersonate")).toBe(true);
  });

  it("grants nothing to non-super-admins", () => {
    for (const v of [false, undefined, null, []]) {
      expect(hasSuperAdminPermission(v, "view")).toBe(false);
    }
  });

  it("does not trust truthy non-boolean values", () => {
    expect(
      hasSuperAdminPermission("true" as unknown as SuperAdmin, "view"),
    ).toBe(false);
    expect(hasSuperAdminPermission(1 as unknown as SuperAdmin, "grant")).toBe(
      false,
    );
  });

  it("grants only listed permissions", () => {
    expect(hasSuperAdminPermission(["billing"], "billing")).toBe(true);
    expect(hasSuperAdminPermission(["billing"], "impersonate")).toBe(false);
    expect(hasSuperAdminPermission(["billing"], "grant")).toBe(false);
  });

  it("implies view from any known permission, but not from junk", () => {
    expect(hasSuperAdminPermission(["sso"], "view")).toBe(true);
    expect(
      hasSuperAdminPermission(["bogus"] as unknown as SuperAdmin, "view"),
    ).toBe(false);
  });
});

describe("canChangeSuperAdmin", () => {
  it("requires grant", () => {
    expect(canChangeSuperAdmin(["view", "users"], false, ["view"])).toBe(false);
  });

  it("lets full super admins do anything", () => {
    expect(canChangeSuperAdmin(true, false, true)).toBe(true);
    expect(canChangeSuperAdmin(true, true, false)).toBe(true);
  });

  it("only full super admins can grant or revoke full access", () => {
    const actor: SuperAdmin = ["grant", "billing"];
    expect(canChangeSuperAdmin(actor, false, true)).toBe(false);
    expect(canChangeSuperAdmin(actor, true, ["billing"])).toBe(false);
  });

  it("caps grants to what the granter holds", () => {
    const actor: SuperAdmin = ["grant", "billing"];
    expect(canChangeSuperAdmin(actor, false, ["billing"])).toBe(true);
    expect(canChangeSuperAdmin(actor, false, ["view"])).toBe(true);
    expect(canChangeSuperAdmin(actor, false, ["impersonate"])).toBe(false);
  });

  it("cannot touch a user holding permissions the granter lacks", () => {
    const actor: SuperAdmin = ["grant", "billing"];
    expect(canChangeSuperAdmin(actor, ["sso"], ["sso", "billing"])).toBe(false);
    expect(canChangeSuperAdmin(actor, ["sso"], false)).toBe(false);
  });

  it("lets a granter drop their own permissions but not add new ones", () => {
    const self: SuperAdmin = ["grant", "billing"];
    expect(canChangeSuperAdmin(self, self, ["grant"])).toBe(true);
    expect(canChangeSuperAdmin(self, self, ["grant", "billing", "sso"])).toBe(
      false,
    );
  });
});

describe("holdsAllSuperAdminPermissions", () => {
  it("protects super admins from less privileged ones", () => {
    expect(holdsAllSuperAdminPermissions(["users"], true)).toBe(false);
    expect(holdsAllSuperAdminPermissions(["users"], ["sso"])).toBe(false);
    expect(holdsAllSuperAdminPermissions(["users"], ["users"])).toBe(true);
    expect(holdsAllSuperAdminPermissions(["users"], false)).toBe(true);
  });
});

describe("normalizeSuperAdmin", () => {
  it("dedupes, orders, drops junk, and collapses empty to false", () => {
    expect(
      normalizeSuperAdmin([
        "grant",
        "view",
        "grant",
        "bogus",
      ] as unknown as SuperAdmin),
    ).toEqual(["view", "grant"]);
    expect(normalizeSuperAdmin([])).toBe(false);
    expect(normalizeSuperAdmin(undefined)).toBe(false);
    expect(normalizeSuperAdmin(true)).toBe(true);
  });
});
