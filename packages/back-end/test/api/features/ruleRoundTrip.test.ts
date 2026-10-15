import type { FeatureRule } from "shared/types/feature";
import { postFeatureRuleV2, postFeatureValidator } from "shared/validators";
import {
  normalizeRuleForApiV2,
  normalizeRuleForFeatureEnv,
} from "back-end/src/services/features";

// Every key the read-model emitters actually produce must be accepted by the
// strict write schemas: stored rule → GET emitter → write schema.

const stored = {
  id: "fr_1",
  description: "d",
  enabled: true,
  condition: '{"country": "US"}',
  savedGroups: [{ match: "all", ids: ["grp_1"] }],
  prerequisites: [{ id: "parent", condition: '{"value": true}' }],
  scheduleRules: [
    { timestamp: "2030-01-01T00:00:00.000Z", enabled: true },
    { timestamp: null, enabled: false },
  ],
  scheduleType: "schedule",
  rampScheduleId: "rs_1",
  allEnvironments: false,
  environments: ["production"],
  allProjects: false,
  projects: ["prj_1"],
};

const rules: FeatureRule[] = [
  { ...stored, type: "force", value: "true", sparse: false },
  {
    ...stored,
    type: "rollout",
    value: "true",
    coverage: 0.5,
    hashAttribute: "id",
    seed: "seed",
    hashVersion: 2,
  },
  {
    ...stored,
    type: "experiment-ref",
    experimentId: "exp_1",
    variations: [
      { variationId: "v0", value: "false" },
      { variationId: "v1", value: "true" },
    ],
  },
] as unknown as FeatureRule[];

const v1Body = (rule: unknown) => ({
  id: "f",
  owner: "o",
  valueType: "boolean",
  defaultValue: "false",
  environments: { production: { enabled: true, rules: [rule] } },
});

describe("GET → POST round-trip of every emitted rule key", () => {
  it.each(rules.map((r) => [r.type, r] as const))(
    "v1: a %s rule emitted by the read model is accepted by the write schema",
    (_type, rule) => {
      const emitted = normalizeRuleForFeatureEnv(rule);
      const res = postFeatureValidator.bodySchema.safeParse(v1Body(emitted));
      expect(res.success ? null : res.error.issues).toBeNull();
      // v2 scope is implied by the env bucket and must not leak into v1.
      expect(emitted).not.toHaveProperty("allEnvironments");
      expect(emitted).not.toHaveProperty("environments");
    },
  );

  it("v1 only emits coverage on rule types that have one", () => {
    expect(normalizeRuleForFeatureEnv(rules[0])).not.toHaveProperty("coverage");
    expect(normalizeRuleForFeatureEnv(rules[1])).toHaveProperty(
      "coverage",
      0.5,
    );
  });

  // The rule modal used to persist form defaults on rule types that don't
  // declare them (`coverage: 1` on force, `coverage`/`hashVersion` on
  // experiment-ref); the v1 GET must not echo them back.
  const strayKeys = {
    coverage: 1,
    hashVersion: 2,
    hashAttribute: "id",
    seed: "",
    disableStickyBucketing: false,
  };
  const rulesWithStrayKeys = [rules[0], rules[2]].map(
    (r) => ({ ...r, ...strayKeys }) as unknown as FeatureRule,
  );

  it.each(rulesWithStrayKeys)(
    "v1: a stored $type rule with undeclared keys round-trips",
    (rule) => {
      const emitted = normalizeRuleForFeatureEnv(rule);
      for (const key of Object.keys(strayKeys)) {
        expect(emitted).not.toHaveProperty(key);
      }
      expect(emitted).toHaveProperty("rampScheduleId", "rs_1");
      const res = postFeatureValidator.bodySchema.safeParse(v1Body(emitted));
      expect(res.success ? null : res.error.issues).toBeNull();
    },
  );

  it("v1 keeps declared bucketing keys on rollout rules", () => {
    const emitted = normalizeRuleForFeatureEnv(rules[1]);
    expect(emitted).toMatchObject({
      coverage: 0.5,
      hashAttribute: "id",
      seed: "seed",
      hashVersion: 2,
    });
  });

  it.each(rules.map((r) => [r.type, r] as const))(
    "v2: a %s rule emitted by the read model is accepted by the write schema",
    (_type, rule) => {
      const emitted = normalizeRuleForApiV2(rule);
      const res = postFeatureRuleV2.safeParse(emitted);
      expect(res.success ? null : res.error.issues).toBeNull();
    },
  );
});
