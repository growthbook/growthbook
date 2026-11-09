import { LinkedFeatureInfo } from "shared/types/experiment";
import {
  getQaOverrideWaitingFeatures,
  qaOverrideAppliesToConnection,
  qaOverrideFiltersAreEmpty,
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
  it("treats {} and an empty condition as no filters", () => {
    expect(qaOverrideFiltersAreEmpty({})).toBe(true);
    expect(qaOverrideFiltersAreEmpty({ condition: "{}" })).toBe(true);
    expect(qaOverrideHasCondition({ condition: "{}" })).toBe(false);
    expect(qaOverrideFiltersAreEmpty({ condition: '{"id":"x"}' })).toBe(false);
    expect(qaOverrideFiltersAreEmpty({ projects: ["p"] })).toBe(false);
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
    // A connection serving every project matches any project filter.
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
