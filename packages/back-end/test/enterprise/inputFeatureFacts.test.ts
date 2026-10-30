import { FeatureInterface } from "shared/types/feature";
import {
  buildHookInputFeatureFacts,
  buildInputFeatureFactsById,
  loadInputFeatureFacts,
  withInputFeatureFacts,
} from "back-end/src/enterprise/sandbox/inputFeatureFacts";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
import { Context } from "back-end/src/models/BaseModel";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeaturesByIds: jest.fn(),
}));

const mockGetFeaturesByIds = getFeaturesByIds as jest.MockedFunction<
  typeof getFeaturesByIds
>;

const envs = ["dev", "production"];

const feature = (over: Record<string, unknown> = {}): FeatureInterface =>
  ({
    id: "f1",
    organization: "org_1",
    owner: "",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    version: 1,
    valueType: "boolean",
    defaultValue: "false",
    environmentSettings: {
      dev: { enabled: true },
      production: { enabled: false },
    },
    rules: [],
    ...over,
  }) as FeatureInterface;

const rule = (over: Record<string, unknown> = {}) => ({
  id: "fr_1",
  type: "force",
  description: "",
  value: "true",
  allEnvironments: false,
  environments: ["production"],
  ...over,
});

describe("buildHookInputFeatureFacts", () => {
  it("returns the basic facts for a plain flag", () => {
    expect(buildHookInputFeatureFacts(feature(), envs)).toEqual({
      project: "",
      archived: false,
      valueType: "boolean",
      booleanDefault: false,
      hasPrerequisites: false,
      hasConfig: false,
      hasHoldout: false,
      environments: {
        dev: { enabled: true, hasRules: false },
        production: { enabled: false, hasRules: false },
      },
    });
  });

  it("reads project and archived", () => {
    const facts = buildHookInputFeatureFacts(
      feature({ project: "prj_1", archived: true }),
      envs,
    );
    expect(facts.project).toBe("prj_1");
    expect(facts.archived).toBe(true);
  });

  it("only sets booleanDefault for a boolean flag with a true/false default", () => {
    expect(
      buildHookInputFeatureFacts(feature({ defaultValue: "true" }), envs)
        .booleanDefault,
    ).toBe(true);
    expect(
      buildHookInputFeatureFacts(feature({ defaultValue: "1" }), envs)
        .booleanDefault,
    ).toBeNull();
    expect(
      buildHookInputFeatureFacts(
        feature({ valueType: "string", defaultValue: "true" }),
        envs,
      ).booleanDefault,
    ).toBeNull();
  });

  it("blanks an unknown valueType", () => {
    const facts = buildHookInputFeatureFacts(
      feature({ valueType: "bogus" }),
      envs,
    );
    expect(facts.valueType).toBe("");
    expect(facts.booleanDefault).toBeNull();
  });

  it("gives one environment entry per org environment", () => {
    const facts = buildHookInputFeatureFacts(feature(), [
      "dev",
      "production",
      "staging",
    ]);
    expect(Object.keys(facts.environments)).toEqual([
      "dev",
      "production",
      "staging",
    ]);
    expect(facts.environments.staging).toEqual({
      enabled: false,
      hasRules: false,
    });
  });

  it("counts disabled and scheduled rules toward hasRules", () => {
    const facts = buildHookInputFeatureFacts(
      feature({
        rules: [
          rule({ enabled: false }),
          rule({
            id: "fr_2",
            environments: ["dev"],
            scheduleRules: [
              { enabled: true, timestamp: "2099-01-01T00:00:00Z" },
            ],
          }),
        ],
      }),
      envs,
    );
    expect(facts.environments.production.hasRules).toBe(true);
    expect(facts.environments.dev.hasRules).toBe(true);
  });

  it("scopes rules by environment", () => {
    const facts = buildHookInputFeatureFacts(
      feature({ rules: [rule(), rule({ id: "fr_2", environments: [] })] }),
      envs,
    );
    expect(facts.environments.production.hasRules).toBe(true);
    expect(facts.environments.dev.hasRules).toBe(false);

    const all = buildHookInputFeatureFacts(
      feature({ rules: [rule({ allEnvironments: true })] }),
      envs,
    );
    expect(all.environments.dev.hasRules).toBe(true);
  });

  it("detects flag-level and environment-level prerequisites", () => {
    const prereq = [{ id: "parent", condition: "{}" }];
    expect(
      buildHookInputFeatureFacts(feature({ prerequisites: prereq }), envs)
        .hasPrerequisites,
    ).toBe(true);
    expect(
      buildHookInputFeatureFacts(
        feature({
          environmentSettings: {
            dev: { enabled: true },
            production: { enabled: true, prerequisites: prereq },
          },
        }),
        envs,
      ).hasPrerequisites,
    ).toBe(true);
    expect(
      buildHookInputFeatureFacts(feature({ prerequisites: [] }), envs)
        .hasPrerequisites,
    ).toBe(false);
  });

  it("detects a base config or a default value that extends a config", () => {
    expect(
      buildHookInputFeatureFacts(
        feature({ valueType: "json", defaultValue: "{}", baseConfig: "cfg" }),
        envs,
      ).hasConfig,
    ).toBe(true);
    expect(
      buildHookInputFeatureFacts(
        feature({
          valueType: "json",
          defaultValue: JSON.stringify({ $extends: ["@config:cfg"] }),
        }),
        envs,
      ).hasConfig,
    ).toBe(true);
    expect(
      buildHookInputFeatureFacts(
        feature({ valueType: "json", defaultValue: "{}", baseConfig: null }),
        envs,
      ).hasConfig,
    ).toBe(false);
  });

  it("detects a holdout", () => {
    expect(
      buildHookInputFeatureFacts(
        feature({ holdout: { id: "hld_1", value: "false" } }),
        envs,
      ).hasHoldout,
    ).toBe(true);
    expect(
      buildHookInputFeatureFacts(
        feature({ holdout: { id: "", value: "" } }),
        envs,
      ).hasHoldout,
    ).toBe(false);
  });

  describe("malformed stored fields read as the cautious answer", () => {
    it("treats non-array rules as having rules everywhere", () => {
      const facts = buildHookInputFeatureFacts(
        feature({ rules: "oops" }),
        envs,
      );
      expect(facts.environments.dev.hasRules).toBe(true);
      expect(facts.environments.production.hasRules).toBe(true);
    });

    it("treats a rule with a malformed environments field as targeting every env", () => {
      const facts = buildHookInputFeatureFacts(
        feature({ rules: [rule({ environments: "production" })] }),
        envs,
      );
      expect(facts.environments.dev.hasRules).toBe(true);
    });

    it("skips null rule slots but counts non-object rules", () => {
      expect(
        buildHookInputFeatureFacts(feature({ rules: [null] }), envs)
          .environments.dev.hasRules,
      ).toBe(false);
      expect(
        buildHookInputFeatureFacts(feature({ rules: ["oops"] }), envs)
          .environments.dev.hasRules,
      ).toBe(true);
    });

    it("treats a non-boolean enabled as not enabled", () => {
      const facts = buildHookInputFeatureFacts(
        feature({
          environmentSettings: {
            dev: { enabled: "true" },
            production: "oops",
          },
        }),
        envs,
      );
      expect(facts.environments.dev.enabled).toBe(false);
      expect(facts.environments.production.enabled).toBe(false);
    });

    it("treats malformed prerequisites as present", () => {
      expect(
        buildHookInputFeatureFacts(feature({ prerequisites: "oops" }), envs)
          .hasPrerequisites,
      ).toBe(true);
      expect(
        buildHookInputFeatureFacts(
          feature({ environmentSettings: { dev: "oops" } }),
          envs,
        ).hasPrerequisites,
      ).toBe(true);
      expect(
        buildHookInputFeatureFacts(
          feature({ environmentSettings: "oops" }),
          envs,
        ).hasPrerequisites,
      ).toBe(true);
    });

    it("treats malformed baseConfig and holdout as present", () => {
      const facts = buildHookInputFeatureFacts(
        feature({ baseConfig: 42, holdout: "oops" }),
        envs,
      );
      expect(facts.hasConfig).toBe(true);
      expect(facts.hasHoldout).toBe(true);
    });

    it("blanks a non-string project", () => {
      expect(
        buildHookInputFeatureFacts(feature({ project: 42 }), envs).project,
      ).toBe("");
    });
  });
});

describe("buildInputFeatureFactsById", () => {
  it("builds facts keyed by flag id", () => {
    const facts = buildInputFeatureFactsById(
      [feature({ id: "a" }), feature({ id: "b", archived: true })],
      null,
      envs,
    );
    expect([...facts.keys()]).toEqual(["a", "b"]);
    expect(facts.get("b")?.archived).toBe(true);
  });

  it("prefers a bulk publish's proposed state over the saved one", () => {
    const saved = feature({
      id: "kill",
      environmentSettings: {
        dev: { enabled: true },
        production: { enabled: true },
      },
    });
    const proposed = feature({
      id: "kill",
      environmentSettings: {
        dev: { enabled: true },
        production: { enabled: false },
      },
    });
    const facts = buildInputFeatureFactsById(
      [saved, feature({ id: "other" })],
      new Map([["kill", proposed]]),
      envs,
    );
    expect(facts.get("kill")?.environments.production.enabled).toBe(false);
    expect(facts.get("other")?.environments.dev.enabled).toBe(true);
  });

  it("includes a flag that only exists in the overlay", () => {
    const facts = buildInputFeatureFactsById(
      [],
      new Map([["new", feature({ id: "new", project: "prj_1" })]]),
      envs,
    );
    expect(facts.get("new")?.project).toBe("prj_1");
  });
});

describe("withInputFeatureFacts", () => {
  const facts = new Map([
    ["a", buildHookInputFeatureFacts(feature({ id: "a" }), envs)],
  ]);
  const args = { feature: { id: "x" } };

  it("returns the args unchanged for a hook without a list", () => {
    expect(withInputFeatureFacts({}, facts, args)).toBe(args);
    expect(withInputFeatureFacts({ inputFeatures: [] }, facts, args)).toBe(
      args,
    );
  });

  it("adds facts for each listed id, with null for a missing flag", () => {
    expect(
      withInputFeatureFacts({ inputFeatures: ["a", "gone"] }, facts, args),
    ).toEqual({
      ...args,
      inputFeatureFacts: { a: facts.get("a"), gone: null },
    });
  });
});

describe("loadInputFeatureFacts", () => {
  const scanContext = (overlay?: Map<string, FeatureInterface>) =>
    ({
      org: {
        settings: {
          environments: envs.map((id) => ({ id })),
        },
      },
      featureScanOverlay: overlay,
    }) as unknown as Context;

  beforeEach(() => mockGetFeaturesByIds.mockReset());

  it("skips the read when no hook lists flags", async () => {
    const facts = await loadInputFeatureFacts(scanContext(), [
      {},
      { inputFeatures: [] },
    ]);
    expect(facts.size).toBe(0);
    expect(mockGetFeaturesByIds).not.toHaveBeenCalled();
  });

  it("reads each listed id once across the batch", async () => {
    mockGetFeaturesByIds.mockResolvedValue([feature({ id: "a" })]);
    const facts = await loadInputFeatureFacts(scanContext(), [
      { inputFeatures: ["a", "b"] },
      { inputFeatures: ["a"] },
    ]);
    expect(mockGetFeaturesByIds).toHaveBeenCalledTimes(1);
    expect(mockGetFeaturesByIds.mock.calls[0][1]).toEqual(["a", "b"]);
    expect([...facts.keys()]).toEqual(["a"]);
    expect(Object.keys(facts.get("a")?.environments ?? {})).toEqual(envs);
  });

  it("applies the scan context's bulk publish overlay", async () => {
    mockGetFeaturesByIds.mockResolvedValue([
      feature({ id: "a", archived: false }),
    ]);
    const facts = await loadInputFeatureFacts(
      scanContext(new Map([["a", feature({ id: "a", archived: true })]])),
      [{ inputFeatures: ["a"] }],
    );
    expect(facts.get("a")?.archived).toBe(true);
  });

  it("fails when the read fails", async () => {
    mockGetFeaturesByIds.mockRejectedValue(new Error("db down"));
    await expect(
      loadInputFeatureFacts(scanContext(), [{ inputFeatures: ["a"] }]),
    ).rejects.toThrow("db down");
  });
});
