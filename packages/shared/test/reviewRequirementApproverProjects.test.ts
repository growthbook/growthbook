import {
  featureReviewCandidateProjects,
  getRevisionReviewRequirement,
} from "shared/util";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { OrganizationSettings } from "shared/types/organization";

const toEnvs = (ids: string[]) => ids.map((id) => ({ id, description: "" }));

// prj_a has a rule of its own; prj_c inherits the organization-wide rule.
const rule = (projects: string[], environments: string[] = []) => ({
  requireReviewOn: true,
  resetReviewOnChange: false,
  environments,
  projects,
});
const settings = (over: Partial<OrganizationSettings> = {}) =>
  ({
    requireReviews: [rule([]), rule(["prj_a"])],
    ...over,
  }) as OrganizationSettings;

const feature = {
  project: "prj_b",
  targetingProjects: ["prj_a", "prj_c"],
  environmentSettings: {
    dev: { enabled: true },
    production: { enabled: true },
  },
} as unknown as FeatureInterface;
const base = {
  defaultValue: "a",
  rules: [],
  environmentsEnabled: { dev: true, production: true },
} as unknown as FeatureRevisionInterface;
const globalChange = { ...base, defaultValue: "b" } as FeatureRevisionInterface;

const requirement = (
  revision: FeatureRevisionInterface,
  orgSettings: OrganizationSettings = settings(),
  forFeature: FeatureInterface = feature,
) =>
  getRevisionReviewRequirement({
    feature: forFeature,
    baseRevision: base,
    revision,
    orgEnvironments: toEnvs(["dev", "production"]),
    settings: orgSettings,
  });

describe("approverProjects", () => {
  it("names targeting projects whose own rule fired, never the primary or inheritors", () => {
    const out = requirement(globalChange);
    expect(out.required).toBe(true);
    expect(out.approverProjects).toEqual(["prj_a"]);
  });

  it("is empty when targeting projects are governed loosely", () => {
    const out = requirement(
      globalChange,
      settings({ targetingReviewMode: [{ projects: [], mode: "loose" }] }),
    );
    expect(out.required).toBe(true);
    expect(out.approverProjects).toEqual([]);
  });

  it("is empty when the project's rule does not fire for this change", () => {
    const out = requirement(
      {
        ...base,
        rules: [
          {
            id: "r1",
            type: "force",
            description: "",
            value: "true",
            enabled: true,
            environments: ["dev"],
          },
        ],
      } as unknown as FeatureRevisionInterface,
      settings({ requireReviews: [rule([]), rule(["prj_a"], ["production"])] }),
    );
    expect(out.required).toBe(true);
    expect(out.approverProjects).toEqual([]);
  });

  it("resolves all-projects targeting to the projects with a rule of their own", () => {
    const out = requirement(globalChange, settings(), {
      ...feature,
      targetingProjects: [],
      targetingAllProjects: true,
    } as FeatureInterface);
    expect(out.approverProjects).toEqual(["prj_a"]);
  });

  it("is absent under the legacy boolean setting", () => {
    expect(
      requirement(globalChange, {
        requireReviews: true,
      } as OrganizationSettings).approverProjects,
    ).toEqual([]);
  });
});

describe("featureReviewCandidateProjects", () => {
  it("lists the primary first, then targeting projects with their own rule", () => {
    expect(featureReviewCandidateProjects(feature, settings())).toEqual([
      "prj_b",
      "prj_a",
    ]);
  });

  it("is just the primary under loose mode or the legacy setting", () => {
    expect(
      featureReviewCandidateProjects(
        feature,
        settings({ targetingReviewMode: [{ projects: [], mode: "loose" }] }),
      ),
    ).toEqual(["prj_b"]);
    expect(
      featureReviewCandidateProjects(feature, {
        requireReviews: true,
      } as OrganizationSettings),
    ).toEqual(["prj_b"]);
  });
});
