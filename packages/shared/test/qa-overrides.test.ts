import { LinkedFeatureInfo } from "shared/types/experiment";
import {
  getQaOverrideWaitingFeatures,
  reorderQaOverridesInEnvironment,
  qaOverrideAppliesToConnection,
  qaOverrideHasCondition,
  sortQaOverrides,
} from "../src/util/qa-overrides";

type Linked = Pick<
  LinkedFeatureInfo,
  "feature" | "state" | "environmentStates"
>;

const linked = (
  id: string,
  state: Linked["state"],
  environmentStates: Linked["environmentStates"] = {},
): Linked =>
  ({ feature: { id }, state, environmentStates }) as unknown as Linked;

describe("getQaOverrideWaitingFeatures", () => {
  const override = { environment: "dev" };

  it("is empty when every linked Feature Flag serves the environment", () => {
    expect(
      getQaOverrideWaitingFeatures(override, [
        linked("flag", "live", { dev: "active", production: "disabled-env" }),
      ]),
    ).toEqual([]);
    expect(getQaOverrideWaitingFeatures(override, [])).toEqual([]);
  });

  it("reports a rule that is not live yet, whatever the environment says", () => {
    expect(
      getQaOverrideWaitingFeatures(override, [
        linked("a", "draft", { dev: "active" }),
        linked("b", "discarded"),
        linked("c", "archived"),
      ]),
    ).toEqual([
      { featureId: "a", reason: "draft" },
      { featureId: "b", reason: "discarded" },
      { featureId: "c", reason: "archived" },
    ]);
  });

  it("reports the environment state of a live rule", () => {
    expect(
      getQaOverrideWaitingFeatures(override, [
        linked("off", "live", { dev: "disabled-env" }),
        linked("rule-off", "live", { dev: "disabled-rule" }),
        linked("missing", "live", { dev: "missing" }),
      ]),
    ).toEqual([
      { featureId: "off", reason: "disabled-env" },
      { featureId: "rule-off", reason: "disabled-rule" },
      { featureId: "missing", reason: "missing" },
    ]);
  });

  it("only looks at the override's own environment", () => {
    expect(
      getQaOverrideWaitingFeatures(override, [
        linked("flag", "live", { production: "disabled-env" }),
      ]),
    ).toEqual([]);
  });
});

describe("filter helpers", () => {
  it("treats {} and an empty condition as no condition", () => {
    expect(qaOverrideHasCondition({})).toBe(false);
    expect(qaOverrideHasCondition({ condition: "{}" })).toBe(false);
    expect(qaOverrideHasCondition({ condition: '{"id":"x"}' })).toBe(true);
  });

  it("matches a connection by environment, connection filter and project filter", () => {
    const dev = { id: "sdk", environment: "dev", projects: ["p1"] };
    const base = { environment: "dev", filters: {} };
    expect(qaOverrideAppliesToConnection(base, dev)).toBe(true);
    expect(
      qaOverrideAppliesToConnection(base, { ...dev, environment: "staging" }),
    ).toBe(false);
    expect(
      qaOverrideAppliesToConnection(
        { ...base, filters: { sdkConnections: ["other"] } },
        dev,
      ),
    ).toBe(false);
    expect(
      qaOverrideAppliesToConnection(
        { ...base, filters: { projects: ["p2"] } },
        dev,
      ),
    ).toBe(false);
    expect(
      qaOverrideAppliesToConnection(
        { ...base, filters: { projects: ["p2"] } },
        { ...dev, projects: [] },
      ),
    ).toBe(true);
  });

  it("sorts by order, then creation time, without mutating the input", () => {
    const a = { id: "a", order: 1, dateCreated: new Date("2026-01-02") };
    const b = { id: "b", order: 0, dateCreated: new Date("2026-01-03") };
    const c = { id: "c", order: 1, dateCreated: "2026-01-01" };
    const input = [a, b, c];
    expect(sortQaOverrides(input).map((o) => o.id)).toEqual(["b", "c", "a"]);
    expect(input.map((o) => o.id)).toEqual(["a", "b", "c"]);
  });
});

describe("getQaOverrideWaitingFeatures draft version", () => {
  it("carries the draft's version so the UI can link to it", () => {
    expect(
      getQaOverrideWaitingFeatures({ environment: "dev" }, [
        {
          feature: { id: "f" },
          state: "draft",
          environmentStates: {},
          draftRevisionVersion: 12,
        } as unknown as Parameters<typeof getQaOverrideWaitingFeatures>[1][0],
      ]),
    ).toEqual([{ featureId: "f", reason: "draft", draftVersion: 12 }]);
  });
});

describe("reorderQaOverridesInEnvironment", () => {
  const overrides = [
    { id: "a", environment: "dev", order: 0 },
    { id: "b", environment: "staging", order: 1 },
    { id: "c", environment: "dev", order: 2 },
  ];

  it("renumbers only the environment being reordered", () => {
    const changes = reorderQaOverridesInEnvironment(overrides, "dev", [
      "c",
      "a",
    ]);
    expect(changes?.map((c) => [c.override.id, c.order])).toEqual([
      ["c", 0],
      ["a", 1],
    ]);
  });

  it("skips rows that already have their new order", () => {
    const changes = reorderQaOverridesInEnvironment(overrides, "dev", [
      "a",
      "c",
    ]);
    expect(changes?.map((c) => [c.override.id, c.order])).toEqual([["c", 1]]);
  });

  it("rejects ids that aren't exactly that environment's overrides", () => {
    expect(reorderQaOverridesInEnvironment(overrides, "dev", ["a"])).toBeNull();
    expect(
      reorderQaOverridesInEnvironment(overrides, "dev", ["a", "a"]),
    ).toBeNull();
    expect(
      reorderQaOverridesInEnvironment(overrides, "dev", ["a", "b"]),
    ).toBeNull();
    expect(
      reorderQaOverridesInEnvironment(overrides, "dev", ["a", "c", "b"]),
    ).toBeNull();
  });
});
