import { getCreateReviewRequirement } from "shared/util";
import { FeatureInterface } from "shared/types/feature";
import {
  Environment,
  OrganizationSettings,
  RequireReview,
} from "shared/types/organization";

const orgEnvironments: Environment[] = [
  { id: "dev", description: "" },
  { id: "production", description: "" },
];

const rule = (over: Partial<RequireReview> = {}): RequireReview => ({
  requireReviewOn: true,
  resetReviewOnChange: false,
  environments: [],
  projects: [],
  ...over,
});

// A brand-new flag, enabled in the listed environments.
const newFlag = (
  enabled: string[],
  over: Partial<FeatureInterface> = {},
): FeatureInterface => ({
  id: "new-flag",
  organization: "org_1",
  owner: "",
  valueType: "boolean",
  defaultValue: "false",
  version: 1,
  dateCreated: new Date(),
  dateUpdated: new Date(),
  project: "",
  environmentSettings: Object.fromEntries(
    orgEnvironments.map((e) => [e.id, { enabled: enabled.includes(e.id) }]),
  ),
  rules: [
    {
      id: "fr_1",
      type: "force",
      description: "",
      condition: "",
      enabled: true,
      value: "true",
      allEnvironments: true,
    },
  ],
  ...over,
});

const gatedOn = (
  feature: FeatureInterface,
  settings: OrganizationSettings,
  requireApprovalsLicensed = true,
) =>
  getCreateReviewRequirement({
    feature,
    orgEnvironments,
    settings,
    requireApprovalsLicensed,
  });

describe("getCreateReviewRequirement", () => {
  it("needs no review when no rule requires it", () => {
    expect(
      gatedOn(newFlag(["dev", "production"]), {
        requireReviews: [rule({ requireReviewOn: false })],
      }),
    ).toEqual({ required: false, environments: [] });
  });

  it("gates turning on an environment whose rule requires review", () => {
    expect(
      gatedOn(newFlag(["dev", "production"]), {
        requireReviews: [rule({ environments: ["production"] })],
      }),
    ).toEqual({ required: true, environments: ["production"] });
  });

  it("does not gate turning on dev alone when only production is gated", () => {
    expect(
      gatedOn(newFlag(["dev"]), {
        requireReviews: [rule({ environments: ["production"] })],
      }),
    ).toEqual({ required: false, environments: [] });
  });

  it("follows featureRequireEnvironmentReview, like a toggle", () => {
    expect(
      gatedOn(newFlag(["production"]), {
        requireReviews: [
          rule({
            environments: ["production"],
            featureRequireEnvironmentReview: false,
          }),
        ],
      }),
    ).toEqual({ required: false, environments: [] });
  });

  it("gates every environment the legacy boolean setting covers", () => {
    expect(
      gatedOn(newFlag(["dev", "production"]), { requireReviews: true }),
    ).toEqual({ required: true, environments: ["dev", "production"] });
    // A flag that starts off everywhere changes nothing that needs review.
    expect(gatedOn(newFlag([]), { requireReviews: true })).toEqual({
      required: false,
      environments: [],
    });
  });

  it("needs no review without the approvals license", () => {
    expect(
      gatedOn(
        newFlag(["production"]),
        { requireReviews: [rule({ environments: ["production"] })] },
        false,
      ),
    ).toEqual({ required: false, environments: [] });
  });

  it("applies a strict targeting project's own rule", () => {
    const feature = newFlag(["production"], {
      project: "prj_b",
      targetingProjects: ["prj_a"],
    });
    const requireReviews = [
      rule({ requireReviewOn: false }),
      rule({ projects: ["prj_a"], environments: ["production"] }),
    ];
    expect(gatedOn(feature, { requireReviews })).toEqual({
      required: true,
      environments: ["production"],
    });
    expect(
      gatedOn(feature, {
        requireReviews,
        targetingReviewMode: [{ projects: [], mode: "loose" }],
      }),
    ).toEqual({ required: false, environments: [] });
  });

  it("ignores environments the Feature Flag's project can't be in", () => {
    const scoped = [
      orgEnvironments[0],
      { id: "production", description: "", projects: ["prj_other"] },
    ];
    expect(
      getCreateReviewRequirement({
        feature: newFlag(["dev", "production"], { project: "prj_b" }),
        orgEnvironments: scoped,
        settings: { requireReviews: true },
      }),
    ).toEqual({ required: true, environments: ["dev"] });
  });

  it("accepts just the scope and toggles", () => {
    expect(
      getCreateReviewRequirement({
        feature: {
          project: "",
          environmentSettings: {
            dev: { enabled: true },
            production: { enabled: true },
          },
        },
        orgEnvironments,
        settings: {
          requireReviews: [rule({ environments: ["production"] })],
        },
      }),
    ).toEqual({ required: true, environments: ["production"] });
  });
});
