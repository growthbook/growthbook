import {
  assertValidPermissionLimit,
  getConsentRoleOptions,
} from "back-end/src/services/oauth/permissionLimit";
import { assertProjectRulesReferenceProjects } from "back-end/src/services/organizations";
import { getEffectiveOrgLimits } from "back-end/src/services/plan-limits";

jest.mock("back-end/src/services/organizations", () => ({
  assertProjectRulesReferenceProjects: jest.fn(),
  getEnvironmentIdsFromOrg: jest.fn(() => ["dev", "production"]),
}));

jest.mock("back-end/src/services/plan-limits", () => ({
  getEffectiveOrgLimits: jest.fn(),
}));

function fakeContext({
  supportsRoles = true,
  premium = true,
  deactivatedRoles = [] as string[],
} = {}) {
  const thrower = (kind: string) =>
    jest.fn((message: string) => {
      throw new Error(`${kind}: ${message}`);
    });
  return {
    org: { id: "org-1", deactivatedRoles },
    limits: { orgSupportsRoles: () => supportsRoles },
    hasPremiumFeature: jest.fn(() => premium),
    throwBadRequestError: thrower("bad request"),
    throwPaymentRequiredError: thrower("payment required"),
    throwPlanDoesNotAllowError: thrower("plan"),
  } as never;
}

const limit = (overrides: Record<string, unknown> = {}) => ({
  role: "readonly",
  limitAccessByEnvironment: false,
  environments: [],
  ...overrides,
});

describe("assertValidPermissionLimit", () => {
  it("accepts no limit on any plan", async () => {
    await expect(
      assertValidPermissionLimit(
        fakeContext({ supportsRoles: false, premium: false }),
        null,
      ),
    ).resolves.toBeUndefined();
  });

  it("accepts a valid role, environments and project rules", async () => {
    const context = fakeContext();
    const projectRoles = [{ project: "prj_1", ...limit({ role: "engineer" }) }];

    await assertValidPermissionLimit(
      context,
      limit({
        limitAccessByEnvironment: true,
        environments: ["dev"],
        projectRoles,
      }),
    );

    expect(assertProjectRulesReferenceProjects).toHaveBeenCalledWith(
      context,
      undefined,
      projectRoles,
    );
  });

  it.each([
    ["an unknown role", {}, limit({ role: "wizard" }), "bad request"],
    [
      "a deactivated role",
      { deactivatedRoles: ["readonly"] },
      limit(),
      "bad request",
    ],
    [
      "an unknown environment",
      {},
      limit({ limitAccessByEnvironment: true, environments: ["staging"] }),
      "bad request",
    ],
    [
      "a non-admin role on a plan without roles",
      { supportsRoles: false },
      limit(),
      "payment required",
    ],
    [
      "an environment limit without advanced permissions",
      { premium: false },
      limit({ limitAccessByEnvironment: true, environments: ["dev"] }),
      "plan",
    ],
    [
      "project rules without advanced permissions",
      { premium: false },
      limit({ projectRoles: [{ project: "prj_1", ...limit() }] }),
      "plan",
    ],
  ])("rejects %s", async (_, contextOptions, value, kind) => {
    await expect(
      assertValidPermissionLimit(fakeContext(contextOptions), value),
    ).rejects.toThrow(kind);
  });

  it("keeps an existing role editable after a downgrade", async () => {
    await expect(
      assertValidPermissionLimit(
        fakeContext({ supportsRoles: false }),
        limit(),
        limit(),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("getConsentRoleOptions", () => {
  const orgLimits = (supportsRoles: boolean) =>
    jest
      .mocked(getEffectiveOrgLimits)
      .mockReturnValue({ orgSupportsRoles: () => supportsRoles } as never);

  it("offers nothing when the plan has no roles", () => {
    orgLimits(false);
    expect(getConsentRoleOptions({ id: "org-1" } as never)).toEqual([]);
  });

  it("offers the org's roles except no access and deactivated ones", () => {
    orgLimits(true);
    const ids = getConsentRoleOptions({
      id: "org-1",
      deactivatedRoles: ["analyst"],
    } as never).map((r) => r.id);

    expect(ids).toContain("readonly");
    expect(ids).toContain("engineer");
    expect(ids).not.toContain("noaccess");
    expect(ids).not.toContain("analyst");
  });
});
