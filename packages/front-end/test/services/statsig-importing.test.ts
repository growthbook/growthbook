import { StatsigFeatureGate } from "@/services/importing/statsig/types";
import { transformStatsigFeatureGateToGB } from "@/services/importing/statsig/transformers/featureTransformer";

// ---------------------------------------------------------------------------
// Statsig importer v2 unified-rules invariants.
//
// Unlike the LaunchDarkly importer (which synthesizes ids per-env and needs
// explicit `__<env>` suffixing to avoid collisions), the Statsig importer
// processes each source rule exactly once and stamps its env scope from
// Statsig's own per-rule `environments` metadata. That means the output is
// already v2-shape by construction — these tests pin that so any future
// refactor can't silently reintroduce a per-env fanout.
//
// The invariants mirror the LD importer's:
//   1. `environmentSettings[env]` has NO `rules` key.
//   2. `feature.rules` is a flat array with unique ids.
//   3. Every rule declares its scope (allEnvironments OR environments).
// ---------------------------------------------------------------------------

const AVAILABLE_ENVS = ["development", "production"];
const NOOP_API_CALL = async () => ({});

function mkGate(
  overrides: Partial<StatsigFeatureGate> = {},
): StatsigFeatureGate {
  return {
    id: "fg_test",
    name: "Test Gate",
    description: "",
    isEnabled: true,
    status: "active",
    rules: [],
    ...overrides,
  } as StatsigFeatureGate;
}

describe("transformStatsigFeatureGateToGB — v2 invariants", () => {
  it("emits no per-env rules key on environmentSettings (cross-env merge rule)", async () => {
    const gate = mkGate({
      rules: [
        {
          id: "rule_a",
          name: "All envs 50%",
          passPercentage: 50,
          conditions: [],
          // null == all envs in Statsig's model
          environments: null,
        } as unknown as StatsigFeatureGate["rules"][number],
      ],
    });
    const result = await transformStatsigFeatureGateToGB(
      gate,
      AVAILABLE_ENVS,
      [],
      NOOP_API_CALL,
      "featureGate",
      "",
      true,
    );
    for (const [, env] of Object.entries(result.environmentSettings)) {
      expect(env).not.toHaveProperty("rules");
    }
  });

  it("produces a flat rules array with unique ids across multi-env rules", async () => {
    const gate = mkGate({
      rules: [
        {
          id: "rule_a",
          name: "Dev only",
          passPercentage: 100,
          conditions: [],
          environments: ["development"],
        } as unknown as StatsigFeatureGate["rules"][number],
        {
          id: "rule_b",
          name: "Prod only",
          passPercentage: 100,
          conditions: [],
          environments: ["production"],
        } as unknown as StatsigFeatureGate["rules"][number],
        {
          id: "rule_c",
          name: "All envs",
          passPercentage: 100,
          conditions: [],
          environments: null,
        } as unknown as StatsigFeatureGate["rules"][number],
      ],
    });
    const result = await transformStatsigFeatureGateToGB(
      gate,
      AVAILABLE_ENVS,
      [],
      NOOP_API_CALL,
      "featureGate",
      "",
      true,
    );
    expect(result.rules).toHaveLength(3);
    const ids = result.rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("stamps every rule with an explicit scope (allEnvironments or environments)", async () => {
    const gate = mkGate({
      rules: [
        {
          id: "r_env",
          name: "Env-scoped",
          passPercentage: 100,
          conditions: [],
          environments: ["development"],
        } as unknown as StatsigFeatureGate["rules"][number],
        {
          id: "r_all",
          name: "All envs",
          passPercentage: 100,
          conditions: [],
          environments: null,
        } as unknown as StatsigFeatureGate["rules"][number],
      ],
    });
    const result = await transformStatsigFeatureGateToGB(
      gate,
      AVAILABLE_ENVS,
      [],
      NOOP_API_CALL,
      "featureGate",
      "",
      true,
    );
    const envRule = result.rules.find((r) => r.id === "r_env");
    const allRule = result.rules.find((r) => r.id === "r_all");
    expect(envRule?.allEnvironments).toBe(false);
    expect(envRule?.environments).toEqual(["development"]);
    expect(allRule?.allEnvironments).toBe(true);
    // allEnvironments=true rules MUST NOT also carry an environments list
    // (the flattener would collapse the footprint anyway, but we want
    // normalized output from importers so diffing stays tight).
    expect(allRule?.environments).toBeUndefined();
  });

  it("treats empty environments array as 'no-env' (pending), not 'all-envs'", async () => {
    // Statsig's rule.environments === [] is distinct from null (= all envs).
    // `environments: []` means "applies nowhere" (pending); carry it through
    // literally.
    const gate = mkGate({
      rules: [
        {
          id: "r_pending",
          name: "Pending",
          passPercentage: 100,
          conditions: [],
          environments: [],
        } as unknown as StatsigFeatureGate["rules"][number],
      ],
    });
    const result = await transformStatsigFeatureGateToGB(
      gate,
      AVAILABLE_ENVS,
      [],
      NOOP_API_CALL,
      "featureGate",
      "",
      true,
    );
    const rule = result.rules[0];
    expect(rule.allEnvironments).toBe(false);
    expect(rule.environments).toEqual([]);
  });
});
