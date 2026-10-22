import type { FeatureInterface } from "shared/types/feature";
import type { FeatureRule } from "shared/validators";
import { getActiveRollouts, RolloutLookups } from "back-end/src/util/rollouts";

const rule = (
  overrides: Partial<FeatureRule> & { type: FeatureRule["type"] },
) =>
  ({
    id: "r1",
    description: "",
    allEnvironments: false,
    environments: ["production"],
    enabled: true,
    ...overrides,
  }) as FeatureRule;

const rollout = (coverage: number, overrides: Partial<FeatureRule> = {}) =>
  rule({
    type: "rollout",
    value: "true",
    coverage,
    hashAttribute: "id",
    ...overrides,
  });

const feature = (
  rules: FeatureRule[],
  overrides: Partial<FeatureInterface> = {},
): FeatureInterface =>
  ({
    id: "f1",
    defaultValue: "false",
    valueType: "boolean",
    environmentSettings: {
      production: { enabled: true },
      dev: { enabled: true },
    },
    rules,
    ...overrides,
  }) as unknown as FeatureInterface;

const lookups = (overrides: Partial<RolloutLookups> = {}): RolloutLookups => ({
  experiments: new Map(),
  rampSchedules: new Map(),
  now: new Date("2026-10-22T12:00:00Z"),
  ...overrides,
});

const types = (f: FeatureInterface, env = "production", l = lookups()) =>
  getActiveRollouts(f, env, l).map((r) => `${r.ruleId}:${r.type}`);

describe("getActiveRollouts", () => {
  it("counts a partial percentage rollout", () => {
    expect(types(feature([rollout(0.25)]))).toEqual(["r1:rollout"]);
    expect(
      getActiveRollouts(feature([rollout(0.25)]), "production", lookups())[0],
    ).toMatchObject({
      featureId: "f1",
      environment: "production",
      coverage: 0.25,
    });
  });

  it("ignores rollouts at 0% or 100%, or serving the default value", () => {
    expect(types(feature([rollout(0)]))).toEqual([]);
    expect(types(feature([rollout(1)]))).toEqual([]);
    expect(types(feature([rollout(0.5, { value: "false" })]))).toEqual([]);
  });

  it("ignores force rules, even with targeting", () => {
    expect(
      types(
        feature([
          rule({ type: "force", value: "true", condition: '{"country":"US"}' }),
        ]),
      ),
    ).toEqual([]);
  });

  it("respects environment scope, env toggles, disabled rules and archive", () => {
    expect(types(feature([rollout(0.5)]), "dev")).toEqual([]);
    expect(
      types(feature([rollout(0.5, { allEnvironments: true })]), "dev"),
    ).toEqual(["r1:rollout"]);
    expect(
      types(
        feature([rollout(0.5)], {
          environmentSettings: { production: { enabled: false } },
        }),
      ),
    ).toEqual([]);
    expect(types(feature([rollout(0.5, { enabled: false })]))).toEqual([]);
    expect(types(feature([rollout(0.5)], { archived: true }))).toEqual([]);
  });

  it("ignores a rule outside its schedule window", () => {
    const future = [
      { timestamp: "2026-11-01T00:00:00Z", enabled: true },
      { timestamp: null, enabled: false },
    ];
    expect(types(feature([rollout(0.5, { scheduleRules: future })]))).toEqual(
      [],
    );
    const past = [
      { timestamp: "2026-10-01T00:00:00Z", enabled: true },
      { timestamp: null, enabled: false },
    ];
    expect(types(feature([rollout(0.5, { scheduleRules: past })]))).toEqual([
      "r1:rollout",
    ]);
  });

  it("counts running safe rollouts with differing values only", () => {
    const sr = (status: string, variationValue = "true") =>
      rule({
        type: "safe-rollout",
        controlValue: "false",
        variationValue,
        safeRolloutId: "sr_1",
        status,
        hashAttribute: "id",
        seed: "s",
        trackingKey: "t",
      } as Partial<FeatureRule> & { type: "safe-rollout" });
    expect(types(feature([sr("running")]))).toEqual(["r1:safe-rollout"]);
    expect(types(feature([sr("released")]))).toEqual([]);
    expect(types(feature([sr("rolled-back")]))).toEqual([]);
    expect(types(feature([sr("running", "false")]))).toEqual([]);
  });

  it("counts experiment-ref rules only while the experiment runs with distinct values", () => {
    const ref = (variations: { variationId: string; value: string }[]) =>
      rule({ type: "experiment-ref", experimentId: "exp_1", variations });
    const two = [
      { variationId: "0", value: "false" },
      { variationId: "1", value: "true" },
    ];
    const running = lookups({
      experiments: new Map([["exp_1", { status: "running" }]]),
    });
    expect(types(feature([ref(two)]), "production", running)).toEqual([
      "r1:experiment-ref",
    ]);
    expect(types(feature([ref(two)]))).toEqual([]);
    const stopped = lookups({
      experiments: new Map([["exp_1", { status: "stopped" }]]),
    });
    expect(types(feature([ref(two)]), "production", stopped)).toEqual([]);
    const same = [
      { variationId: "0", value: "true" },
      { variationId: "1", value: "true" },
    ];
    expect(types(feature([ref(same)]), "production", running)).toEqual([]);
  });

  it("reports a rule under a serving ramp schedule as a ramp, whatever its type", () => {
    const serving = lookups({
      rampSchedules: new Map([["r1", { id: "ramp_1", status: "paused" }]]),
    });
    const done = lookups({
      rampSchedules: new Map([["r1", { id: "ramp_1", status: "completed" }]]),
    });
    const forced = feature([rule({ type: "force", value: "true", id: "r1" })]);
    expect(getActiveRollouts(forced, "production", serving)).toMatchObject([
      { type: "ramp-schedule", rampScheduleId: "ramp_1" },
    ]);
    expect(types(forced, "production", done)).toEqual([]);
    // a 100% rollout mid-ramp still counts as a ramp
    expect(types(feature([rollout(1)]), "production", serving)).toEqual([
      "r1:ramp-schedule",
    ]);
  });

  it("excludes a feature statically blocked by a prerequisite", () => {
    const parentOff = feature([], { id: "parent", defaultValue: "false" });
    const parentOn = feature([], { id: "parent", defaultValue: "true" });
    const child = feature([rollout(0.5)], {
      prerequisites: [{ id: "parent", condition: '{"value": true}' }],
    });
    const blocked = lookups({
      featuresMap: new Map([
        ["parent", parentOff],
        ["f1", child],
      ]),
    });
    const open = lookups({
      featuresMap: new Map([
        ["parent", parentOn],
        ["f1", child],
      ]),
    });
    expect(types(child, "production", blocked)).toEqual([]);
    expect(types(child, "production", open)).toEqual(["r1:rollout"]);
    // without a features map, prerequisites are ignored (upper bound)
    expect(types(child)).toEqual(["r1:rollout"]);
  });
});
