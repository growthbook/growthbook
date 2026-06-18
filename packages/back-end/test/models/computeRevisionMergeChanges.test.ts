import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { Environment } from "shared/types/organization";
import { MergeResultChanges } from "shared/util";
import { computeRevisionMergeChanges } from "back-end/src/models/FeatureModel";
import { ReqContext } from "back-end/types/request";

const ORG_ENVS: Environment[] = [
  { id: "dev", description: "" },
  { id: "production", description: "" },
];

function mockContext(envs: Environment[] = ORG_ENVS): ReqContext {
  return {
    org: { settings: { environments: envs } },
  } as unknown as ReqContext;
}

function makeFeature(
  overrides: Partial<FeatureInterface> = {},
): FeatureInterface {
  return {
    id: "feat_test",
    organization: "org_test",
    version: 3,
    defaultValue: "true",
    valueType: "boolean",
    owner: "",
    description: "",
    project: "",
    tags: [],
    dateCreated: new Date("2024-01-01"),
    dateUpdated: new Date("2024-01-01"),
    rules: [],
    environmentSettings: {
      production: { enabled: true },
      dev: { enabled: false },
    },
    ...overrides,
  } as FeatureInterface;
}

const REVISION = { version: 4 } as FeatureRevisionInterface;

describe("computeRevisionMergeChanges", () => {
  it("bumps only the version for an empty merge result", () => {
    const { changes, hasChanges, removeHoldout } = computeRevisionMergeChanges(
      mockContext(),
      makeFeature(),
      REVISION,
      {},
    );

    expect(hasChanges).toBe(false);
    expect(removeHoldout).toBe(false);
    expect(changes).toEqual({ version: 4 });
  });

  it("projects defaultValue changes with the revision version", () => {
    const { changes, hasChanges } = computeRevisionMergeChanges(
      mockContext(),
      makeFeature(),
      REVISION,
      { defaultValue: "false" },
    );

    expect(hasChanges).toBe(true);
    expect(changes.defaultValue).toBe("false");
    expect(changes.version).toBe(4);
  });

  it("backfills rule ids/seeds and computes nextScheduledUpdate for rules", () => {
    const rules = [
      {
        type: "rollout",
        description: "",
        value: "true",
        coverage: 0.5,
        hashAttribute: "id",
        enabled: true,
        allEnvironments: true,
      },
    ] as unknown as FeatureRule[];

    const { changes, hasChanges } = computeRevisionMergeChanges(
      mockContext(),
      makeFeature(),
      REVISION,
      { rules } as MergeResultChanges,
    );

    expect(hasChanges).toBe(true);
    expect(changes.rules?.[0].id).toBeTruthy();
    // Rollout rules without an explicit seed default to their rule id.
    expect((changes.rules?.[0] as { seed?: string }).seed).toBe(
      changes.rules?.[0].id,
    );
    expect("nextScheduledUpdate" in changes).toBe(true);
  });

  it("skips no-op environment toggles so the SDK payload cache is preserved", () => {
    const { changes, hasChanges } = computeRevisionMergeChanges(
      mockContext(),
      makeFeature(),
      REVISION,
      { environmentsEnabled: { production: true } },
    );

    // production is already enabled — no content change, version bump only.
    expect(hasChanges).toBe(false);
    expect(changes).toEqual({ version: 4 });
  });

  it("applies real environment toggles while preserving other env settings", () => {
    const { changes, hasChanges } = computeRevisionMergeChanges(
      mockContext(),
      makeFeature(),
      REVISION,
      { environmentsEnabled: { dev: true } },
    );

    expect(hasChanges).toBe(true);
    expect(changes.environmentSettings?.dev.enabled).toBe(true);
    expect(changes.environmentSettings?.production.enabled).toBe(true);
  });

  it("flags holdout removal without setting changes.holdout", () => {
    const { changes, hasChanges, removeHoldout } = computeRevisionMergeChanges(
      mockContext(),
      makeFeature({
        holdout: { id: "hld_1" },
      } as unknown as Partial<FeatureInterface>),
      REVISION,
      { holdout: null },
    );

    expect(hasChanges).toBe(true);
    expect(removeHoldout).toBe(true);
    expect("holdout" in changes).toBe(false);
  });

  it("maps metadata fields onto the feature changes", () => {
    const { changes, hasChanges } = computeRevisionMergeChanges(
      mockContext(),
      makeFeature(),
      REVISION,
      {
        metadata: {
          description: "new description",
          owner: "new owner",
          tags: ["a"],
        },
      } as MergeResultChanges,
    );

    expect(hasChanges).toBe(true);
    expect(changes.description).toBe("new description");
    expect(changes.owner).toBe("new owner");
    expect(changes.tags).toEqual(["a"]);
  });

  it("does not mutate the feature or write anything", () => {
    const feature = makeFeature();
    const before = JSON.stringify(feature);

    computeRevisionMergeChanges(mockContext(), feature, REVISION, {
      defaultValue: "false",
      environmentsEnabled: { dev: true },
    });

    expect(JSON.stringify(feature)).toBe(before);
  });
});
