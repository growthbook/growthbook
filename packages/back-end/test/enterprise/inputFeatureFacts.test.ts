import { FeatureInterface } from "shared/types/feature";
import { buildHookInputFeatureFacts } from "back-end/src/enterprise/sandbox/inputFeatureFacts";

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
