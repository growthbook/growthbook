import { FeatureInterface } from "shared/types/feature";
import { Environment } from "shared/types/organization";
import { projectFeatureDeleteFootprint } from "back-end/src/util/features";

// The env footprint a project-delete cascade owes delete + publish authority
// over: the union of enabled environments across the project's OWNED features,
// excluding features that merely target it (owned elsewhere, not deleted here).

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

  it("ignores features that only TARGET the project (owned elsewhere)", () => {
    // Deleting project `prj` removes only features whose project IS `prj`. A
    // feature owned by `other` that targets `prj` is not deleted, so its enabled
    // envs must not inflate the footprint (which would over-demand authority).
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
    // Only `owned`'s enabled envs (dev, production) — staging from `targeting`
    // must be absent.
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
