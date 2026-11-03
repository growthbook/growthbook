import {
  adminOrgFiltersValidator,
  buildAdminOrgQuery,
  getLicensePlansForFilter,
} from "back-end/src/util/adminOrgQuery";

describe("buildAdminOrgQuery", () => {
  it("returns an empty query without filters", () => {
    expect(buildAdminOrgQuery({}, {})).toEqual({});
  });

  it("includes legacy enterprise orgs in the Enterprise plan", () => {
    expect(
      buildAdminOrgQuery(
        { plan: "enterprise" },
        { plan: { orgIds: ["org_a"], licenseKeys: ["license_a"] } },
      ),
    ).toEqual({
      $and: [
        {
          $or: [
            { enterprise: true },
            { id: { $in: ["org_a"] }, licenseKey: { $in: ["license_a"] } },
          ],
        },
      ],
    });
  });

  it("treats Starter as not referencing any paid license", () => {
    expect(
      buildAdminOrgQuery(
        { plan: "starter" },
        { plan: { orgIds: ["org_b"], licenseKeys: ["license_b"] } },
      ),
    ).toEqual({
      $and: [
        { enterprise: { $ne: true }, licenseKey: { $nin: ["license_b"] } },
      ],
    });
  });

  it("matches no orgs when a license-based filter finds no licenses", () => {
    expect(buildAdminOrgQuery({ plan: "pro" }, {})).toEqual({
      $and: [
        {
          enterprise: { $ne: true },
          id: { $in: [] },
          licenseKey: { $in: [] },
        },
      ],
    });
  });

  it("keeps suspended and disabled orgs out of subscription statuses", () => {
    expect(
      buildAdminOrgQuery(
        { status: "past_due" },
        { status: { orgIds: ["org_c"], licenseKeys: ["license_c"] } },
      ),
    ).toEqual({
      $and: [
        {
          id: { $in: ["org_c"] },
          licenseKey: { $in: ["license_c"] },
          suspended: { $ne: true },
          disabled: { $ne: true },
        },
      ],
    });
    expect(buildAdminOrgQuery({ status: "suspended" }, {})).toEqual({
      $and: [{ suspended: true, disabled: { $ne: true } }],
    });
    expect(buildAdminOrgQuery({ status: "has_banner" }, {})).toEqual({
      $and: [{ "messages.0": { $exists: true } }],
    });
  });

  it("combines member, date, and login filters", () => {
    const createdAfter = new Date("2026-01-01T00:00:00Z");
    expect(
      buildAdminOrgQuery(
        { minMembers: 10, maxMembers: 49, createdAfter, loginMethod: "none" },
        { ssoOrgIds: ["org_d"] },
      ),
    ).toEqual({
      $and: [
        {
          $expr: {
            $gte: [{ $size: { $ifNull: ["$members", []] } }, 10],
          },
        },
        {
          $expr: {
            $lte: [{ $size: { $ifNull: ["$members", []] } }, 49],
          },
        },
        { dateCreated: { $gte: createdAfter } },
        { id: { $nin: ["org_d"] } },
      ],
    });
  });
});

describe("getLicensePlansForFilter", () => {
  it("looks up every paid plan for Starter", () => {
    expect(getLicensePlansForFilter("starter")).toEqual([
      "pro",
      "pro_sso",
      "enterprise",
    ]);
    expect(getLicensePlansForFilter("pro")).toEqual(["pro", "pro_sso"]);
  });
});

describe("adminOrgFiltersValidator", () => {
  it("coerces query strings and ignores unrelated params", () => {
    expect(
      adminOrgFiltersValidator.parse({
        page: "2",
        minMembers: "5",
        createdAfter: "2026-01-01",
      }),
    ).toEqual({ minMembers: 5, createdAfter: new Date("2026-01-01") });
  });

  it("rejects unknown plans", () => {
    expect(adminOrgFiltersValidator.safeParse({ plan: "gold" }).success).toBe(
      false,
    );
  });
});
