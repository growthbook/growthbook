import { Permissions } from "shared/permissions";
import { UserPermissions } from "shared/types/organization";

// A reviewer who may review, limited to dev.
const devOnlyReviewer: UserPermissions = {
  global: {
    environments: ["dev"],
    limitAccessByEnvironment: true,
    permissions: { reviewFeatures: true, publishFeatures: true },
    envGrants: [
      {
        environments: ["dev"],
        limitAccessByEnvironment: true,
        permissions: ["publishFeatures", "reviewFeatures"],
      },
    ],
  },
  projects: {},
};

// Same role, no environment limit.
const unrestrictedReviewer: UserPermissions = {
  global: {
    environments: [],
    limitAccessByEnvironment: false,
    permissions: { reviewFeatures: true, publishFeatures: true },
    envGrants: [
      {
        environments: [],
        limitAccessByEnvironment: false,
        permissions: ["publishFeatures", "reviewFeatures"],
      },
    ],
  },
  projects: {},
};

const review = (
  perms: UserPermissions,
  envScopedReview: boolean,
  environments: string[],
) =>
  new Permissions(perms, { envScopedReview }).canRevisionAction(
    "feature",
    "review",
    { project: "prj_1" },
    environments,
  );

describe("environment-scoped review", () => {
  describe("off (default)", () => {
    it("lets a dev-limited reviewer review a production draft", () => {
      expect(review(devOnlyReviewer, false, ["production"])).toBe(true);
    });

    it("lets a dev-limited reviewer review an unbound change", () => {
      expect(review(devOnlyReviewer, false, [])).toBe(true);
    });
  });

  describe("on", () => {
    it("refuses a production draft to a dev-limited reviewer", () => {
      expect(review(devOnlyReviewer, true, ["production"])).toBe(false);
    });

    it("allows the environments the reviewer does hold", () => {
      expect(review(devOnlyReviewer, true, ["dev"])).toBe(true);
    });

    it("refuses a draft spanning held and unheld environments", () => {
      expect(review(devOnlyReviewer, true, ["dev", "production"])).toBe(false);
    });

    it("allows an unrestricted reviewer anywhere", () => {
      expect(review(unrestrictedReviewer, true, ["production"])).toBe(true);
    });

    it("fails closed on an unbound change for a limited reviewer", () => {
      expect(review(devOnlyReviewer, true, [])).toBe(false);
    });

    it("allows an unbound change for an unrestricted reviewer", () => {
      expect(review(unrestrictedReviewer, true, [])).toBe(true);
    });

    it("leaves saved groups project-scoped", () => {
      const canReview = new Permissions(
        {
          global: {
            environments: ["dev"],
            limitAccessByEnvironment: true,
            permissions: { reviewSavedGroups: true },
          },
          projects: {},
        },
        { envScopedReview: true },
      ).canRevisionAction("saved-group", "review", { project: "prj_1" }, [
        "production",
      ]);

      expect(canReview).toBe(true);
    });
  });
});
