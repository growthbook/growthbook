import { FeatureInterface } from "shared/types/feature";
import { Environment } from "shared/types/organization";
import { projectFeatureDeleteFootprint } from "back-end/src/util/features";

const orgEnvs: Environment[] = [
  { id: "dev", description: "" },
  { id: "staging", description: "" },
  { id: "production", description: "" },
];

function feat(overrides: Partial<FeatureInterface>): FeatureInterface {
  return {
    id: "f",
    project: "prj",
    environmentSettings: {
      dev: { enabled: true, rules: [] },
      staging: { enabled: false, rules: [] },
      production: { enabled: true, rules: [] },
    },
    ...overrides,
  } as unknown as FeatureInterface;
}

describe("projectFeatureDeleteFootprint", () => {
  it("unions the enabled envs of the project's owned features", () => {
    const features = [
      feat({
        id: "a",
        environmentSettings: {
          dev: { enabled: true, rules: [] },
          production: { enabled: false, rules: [] },
        },
      }),
      feat({
        id: "b",
        environmentSettings: {
          dev: { enabled: false, rules: [] },
          production: { enabled: true, rules: [] },
        },
      }),
    ];
    expect(
      projectFeatureDeleteFootprint(features, "prj", orgEnvs).sort(),
    ).toEqual(["dev", "production"]);
  });

  it("ignores features that only target the project", () => {
    const features = [
      feat({ id: "owned", project: "prj" }),
      feat({
        id: "targeting",
        project: "other",
        targetingProjects: ["prj"],
        environmentSettings: {
          staging: { enabled: true, rules: [] },
        },
      }),
    ];
    expect(
      projectFeatureDeleteFootprint(features, "prj", orgEnvs).sort(),
    ).toEqual(["dev", "production"]);
  });

  it("is empty when the project owns no enabled features", () => {
    const features = [
      feat({
        id: "disabled",
        environmentSettings: {
          dev: { enabled: false, rules: [] },
          production: { enabled: false, rules: [] },
        },
      }),
    ];
    expect(projectFeatureDeleteFootprint(features, "prj", orgEnvs)).toEqual([]);
  });
});
