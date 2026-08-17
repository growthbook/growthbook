import { OrganizationInterface } from "shared/types/organization";
import { Permissions } from "shared/permissions";
import { getUserPermissions } from "back-end/src/util/organization.util";

const feature = { project: "" };

const org = (
  envScopedReview: boolean,
  role: string,
  environments: string[],
): OrganizationInterface =>
  ({
    id: "org_env_review",
    name: "Test Org",
    ownerEmail: "test@test.com",
    url: "https://test.com",
    dateCreated: new Date(),
    settings: {
      envScopedReview,
      environments: [
        { id: "development" },
        { id: "staging" },
        { id: "production" },
      ],
    },
    customRoles: [
      {
        id: "reviewer",
        description: "review only",
        policies: ["FlagsReview"],
      },
    ],
    members: [
      {
        id: "u_1",
        role,
        limitAccessByEnvironment: environments.length > 0,
        environments,
      },
    ],
    invites: [],
  }) as unknown as OrganizationInterface;

const reviewerFor = (
  envScopedReview: boolean,
  role: string,
  environments: string[],
) => {
  const o = org(envScopedReview, role, environments);
  return new Permissions(getUserPermissions({ id: "u_1" }, o, []), {
    envScopedReview,
  });
};

describe("environment-scoped review", () => {
  describe("when the org has it enabled", () => {
    const devOnly = () => reviewerFor(true, "reviewer", ["development"]);

    it("lets a dev-limited reviewer approve a dev-only draft", () => {
      expect(
        devOnly().canReviewFeatureDrafts(feature, {
          scope: "environments",
          environments: ["development"],
        }),
      ).toBe(true);
    });

    it("refuses a dev-limited reviewer on a draft that changes production", () => {
      expect(
        devOnly().canReviewFeatureDrafts(feature, {
          scope: "environments",
          environments: ["production"],
        }),
      ).toBe(false);
    });

    it("refuses when only part of the footprint is covered", () => {
      expect(
        devOnly().canReviewFeatureDrafts(feature, {
          scope: "environments",
          environments: ["development", "production"],
        }),
      ).toBe(false);
    });

    it("fails closed on an unbound change", () => {
      expect(
        devOnly().canReviewFeatureDrafts(feature, { scope: "unbound" }),
      ).toBe(false);
    });

    it("fails closed on a change reaching everywhere", () => {
      expect(
        devOnly().canReviewFeatureDrafts(feature, { scope: "everywhere" }),
      ).toBe(false);
    });

    it("lets an unrestricted reviewer approve anything", () => {
      const anywhere = reviewerFor(true, "reviewer", []);
      expect(
        anywhere.canReviewFeatureDrafts(feature, {
          scope: "environments",
          environments: ["production"],
        }),
      ).toBe(true);
      expect(
        anywhere.canReviewFeatureDrafts(feature, { scope: "unbound" }),
      ).toBe(true);
    });

    it("still refuses someone with no review permission at all", () => {
      expect(
        reviewerFor(true, "collaborator", []).canReviewFeatureDrafts(feature, {
          scope: "environments",
          environments: ["development"],
        }),
      ).toBe(false);
    });
  });

  describe("when the org has it disabled", () => {
    // A review-only role cannot be environment-limited at all while the flag is
    // off, so its limit is discarded when permissions are built. Engineer is the
    // shape that actually exercises the gate: it holds review AND publish, so it
    // is env-limitable either way, and only `scope` decides whether review binds.
    const reviewOnly = () => reviewerFor(false, "reviewer", ["development"]);
    const engineer = () => reviewerFor(false, "engineer", ["development"]);

    it("lets a dev-limited review-only role approve a production draft", () => {
      expect(
        reviewOnly().canReviewFeatureDrafts(feature, {
          scope: "environments",
          environments: ["production"],
        }),
      ).toBe(true);
    });

    it("lets a dev-limited engineer approve a production draft", () => {
      expect(
        engineer().canReviewFeatureDrafts(feature, {
          scope: "environments",
          environments: ["production"],
        }),
      ).toBe(true);
    });

    it("lets a dev-limited engineer approve an unbound change", () => {
      expect(
        engineer().canReviewFeatureDrafts(feature, { scope: "unbound" }),
      ).toBe(true);
    });

    it("still binds an engineer's publish rights to their environments", () => {
      expect(engineer().canPublishFeature(feature, ["development"])).toBe(true);
      expect(engineer().canPublishFeature(feature, ["production"])).toBe(false);
    });
  });

  describe("when enabled, an engineer's review binds per-role", () => {
    const engineer = () => reviewerFor(true, "engineer", ["development"]);

    it("approves dev but refuses production", () => {
      expect(
        engineer().canReviewFeatureDrafts(feature, {
          scope: "environments",
          environments: ["development"],
        }),
      ).toBe(true);
      expect(
        engineer().canReviewFeatureDrafts(feature, {
          scope: "environments",
          environments: ["production"],
        }),
      ).toBe(false);
    });
  });
});

const twoRuleSeniorEngineer = () => {
  const o = org(true, "engineer", ["development"]);
  o.members[0].additionalRoles = [
    { role: "reviewer", limitAccessByEnvironment: false, environments: [] },
  ];
  return new Permissions(getUserPermissions({ id: "u_1" }, o, []), {
    envScopedReview: true,
  });
};

describe("expressing judge-everywhere, operate-in-dev with two rules", () => {
  it("reviews production even though publish is limited to dev", () => {
    const p = twoRuleSeniorEngineer();
    expect(
      p.canReviewFeatureDrafts(feature, {
        scope: "environments",
        environments: ["production"],
      }),
    ).toBe(true);
    expect(p.canPublishFeature(feature, ["production"])).toBe(false);
    expect(p.canPublishFeature(feature, ["development"])).toBe(true);
  });

  it("reviews an unbound change, since the review rule is unrestricted", () => {
    expect(
      twoRuleSeniorEngineer().canReviewFeatureDrafts(feature, {
        scope: "unbound",
      }),
    ).toBe(true);
  });
});

const viaStaffEngineersTeam = () => {
  const o = org(true, "collaborator", []);
  o.members[0].teams = ["team_staff"];
  const teams = [
    {
      id: "team_staff",
      name: "Staff Engineers",
      role: "engineer",
      limitAccessByEnvironment: true,
      environments: ["development"],
      additionalRoles: [
        { role: "reviewer", limitAccessByEnvironment: false, environments: [] },
      ],
      projectRoles: [],
    },
  ];
  return new Permissions(
    getUserPermissions(
      { id: "u_1" },
      o,
      teams as unknown as Parameters<typeof getUserPermissions>[2],
    ),
    { envScopedReview: true },
  );
};

describe("the same two rules applied once via a team", () => {
  it("gives every member review everywhere but publish only in dev", () => {
    const p = viaStaffEngineersTeam();
    expect(
      p.canReviewFeatureDrafts(feature, {
        scope: "environments",
        environments: ["production"],
      }),
    ).toBe(true);
    expect(p.canPublishFeature(feature, ["production"])).toBe(false);
    expect(p.canPublishFeature(feature, ["development"])).toBe(true);
  });

  it("carries the unrestricted review rule through to unbound changes", () => {
    expect(
      viaStaffEngineersTeam().canReviewFeatureDrafts(feature, {
        scope: "unbound",
      }),
    ).toBe(true);
  });
});
