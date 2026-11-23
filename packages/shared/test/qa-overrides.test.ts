import { LinkedFeatureInfo } from "shared/types/experiment";
import {
  experimentSupportsQaOverrides,
  getQaOverrideStaleSdkConnections,
  getQaOverrideStatus,
  getQaOverrideWaitingFeatures,
  getQaTrackingKey,
  isQaTrackingKey,
  reorderQaOverridesInEnvironment,
  qaOverrideAppliesToConnection,
  qaOverrideHasCondition,
  qaOverrideHasOwnTargeting,
  qaOverrideVariationMissing,
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

  it("has its own targeting with a condition or a Saved Group, not with connection or project filters", () => {
    expect(qaOverrideHasOwnTargeting({})).toBe(false);
    expect(qaOverrideHasOwnTargeting({ condition: "{}" })).toBe(false);
    expect(
      qaOverrideHasOwnTargeting({ sdkConnections: ["sdk"], projects: ["p"] }),
    ).toBe(false);
    expect(
      qaOverrideHasOwnTargeting({ savedGroups: [{ match: "all", ids: [] }] }),
    ).toBe(false);
    expect(qaOverrideHasOwnTargeting({ condition: '{"id":"x"}' })).toBe(true);
    expect(
      qaOverrideHasOwnTargeting({
        savedGroups: [{ match: "any", ids: ["grp_1"] }],
      }),
    ).toBe(true);
  });

  it("reports a forced variation that is no longer in the latest phase", () => {
    const experiment = {
      variations: [{ id: "v0" }, { id: "v1" }],
      phases: [],
    } as unknown as Parameters<typeof qaOverrideVariationMissing>[1];
    expect(
      qaOverrideVariationMissing(
        { assignment: { type: "forced", variationId: "v1" } },
        experiment,
      ),
    ).toBe(false);
    expect(
      qaOverrideVariationMissing(
        { assignment: { type: "forced", variationId: "gone" } },
        experiment,
      ),
    ).toBe(true);
    expect(
      qaOverrideVariationMissing(
        { assignment: { type: "random" } },
        experiment,
      ),
    ).toBe(false);
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

  it("finds nothing to change only when the stored order is exactly the requested one", () => {
    const stored = (orders: Record<string, number>) =>
      Object.entries(orders).map(([id, order]) => ({
        id,
        environment: "dev",
        order,
      }));
    expect(
      reorderQaOverridesInEnvironment(stored({ b: 0, a: 1, c: 2 }), "dev", [
        "b",
        "a",
        "c",
      ]),
    ).toEqual([]);
    // Two overlapping reorders of [a, b, c], to [b, a, c] and [a, c, b], can
    // leave this behind. Neither request's order is stored.
    const overlapped = stored({ b: 0, a: 1, c: 1 });
    expect(
      reorderQaOverridesInEnvironment(overlapped, "dev", ["b", "a", "c"])?.map(
        (c) => [c.override.id, c.order],
      ),
    ).toEqual([["c", 2]]);
    expect(
      reorderQaOverridesInEnvironment(overlapped, "dev", ["a", "c", "b"]),
    ).not.toEqual([]);
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

describe("QA tracking key", () => {
  it("marks a key so QA exposures can be told apart from real ones", () => {
    expect(getQaTrackingKey("checkout")).toBe("checkout::qa");
    expect(isQaTrackingKey(getQaTrackingKey("checkout"))).toBe(true);
  });

  it("only matches the suffix", () => {
    expect(isQaTrackingKey("checkout")).toBe(false);
    expect(isQaTrackingKey("checkout::qa::v2")).toBe(false);
    expect(isQaTrackingKey("::qa-checkout")).toBe(false);
    expect(isQaTrackingKey("")).toBe(false);
    expect(isQaTrackingKey(undefined)).toBe(false);
  });
});

describe("experimentSupportsQaOverrides", () => {
  it("allows standard experiments and Bandits", () => {
    expect(experimentSupportsQaOverrides({ type: "standard" })).toBe(true);
    expect(experimentSupportsQaOverrides({ type: "multi-armed-bandit" })).toBe(
      true,
    );
  });

  it("treats a missing type as standard", () => {
    expect(experimentSupportsQaOverrides({})).toBe(true);
  });

  it("rejects other experiment types", () => {
    expect(experimentSupportsQaOverrides({ type: "holdout" })).toBe(false);
  });
});

describe("getQaOverrideStaleSdkConnections", () => {
  const override = {
    environment: "dev",
    filters: { sdkConnections: ["here", "moved", "gone"] },
  };
  const connections = [
    { id: "here", environment: "dev" },
    { id: "moved", environment: "staging" },
  ];

  it("reports listed connections that were deleted or moved", () => {
    expect(getQaOverrideStaleSdkConnections(override, connections)).toEqual([
      { id: "moved", reason: "other-environment" },
      { id: "gone", reason: "deleted" },
    ]);
  });

  it("reports an archived connection, whatever its environment", () => {
    expect(
      getQaOverrideStaleSdkConnections(
        { environment: "dev", filters: { sdkConnections: ["a", "b"] } },
        [
          { id: "a", environment: "dev", archived: true },
          { id: "b", environment: "staging", archived: true },
        ],
      ),
    ).toEqual([
      { id: "a", reason: "archived" },
      { id: "b", reason: "archived" },
    ]);
  });

  it("is empty when the override lists no connections", () => {
    expect(
      getQaOverrideStaleSdkConnections(
        { environment: "dev", filters: {} },
        connections,
      ),
    ).toEqual([]);
  });
});

describe("getQaOverrideStatus", () => {
  const experiment = {
    variations: [
      { id: "v0", key: "0", name: "Control", screenshots: [] },
      { id: "v1", key: "1", name: "Variation 1", screenshots: [] },
    ],
    phases: [],
  } as unknown as Parameters<typeof getQaOverrideStatus>[1]["experiment"];
  const forced = (variationId: string) =>
    ({ type: "forced", variationId }) as const;
  const base = {
    environment: "dev",
    filters: {},
    assignment: forced("v1"),
  };
  const none = { experiment, linkedFeatures: [], connections: [] };

  it("is active when nothing it refers to is missing", () => {
    expect(getQaOverrideStatus(base, none)).toEqual({
      status: "active",
      waitingOn: [],
      invalidReasons: [],
      staleSdkConnections: [],
    });
  });

  it("is invalid when the forced variation was removed", () => {
    const status = getQaOverrideStatus(
      { ...base, assignment: forced("deleted") },
      none,
    );
    expect(status.status).toBe("invalid");
    expect(status.invalidReasons).toEqual(["variation-removed"]);
  });

  it("never reports a removed variation for random assignment", () => {
    expect(
      getQaOverrideStatus({ ...base, assignment: { type: "random" } }, none)
        .status,
    ).toBe("active");
  });

  it("is invalid when none of its SDK Connections is left in the environment", () => {
    const status = getQaOverrideStatus(
      { ...base, filters: { sdkConnections: ["moved", "gone"] } },
      { ...none, connections: [{ id: "moved", environment: "staging" }] },
    );
    expect(status.status).toBe("invalid");
    expect(status.invalidReasons).toEqual(["no-matching-connection"]);
    expect(status.staleSdkConnections).toHaveLength(2);
  });

  it("is invalid when its only SDK Connection is archived", () => {
    const status = getQaOverrideStatus(
      { ...base, filters: { sdkConnections: ["archived"] } },
      {
        ...none,
        connections: [{ id: "archived", environment: "dev", archived: true }],
      },
    );
    expect(status.status).toBe("invalid");
    expect(status.invalidReasons).toEqual(["no-matching-connection"]);
    expect(status.staleSdkConnections).toEqual([
      { id: "archived", reason: "archived" },
    ]);
  });

  it("stays active while one listed SDK Connection is still in the environment", () => {
    const status = getQaOverrideStatus(
      { ...base, filters: { sdkConnections: ["here", "gone"] } },
      { ...none, connections: [{ id: "here", environment: "dev" }] },
    );
    expect(status.status).toBe("active");
    expect(status.invalidReasons).toEqual([]);
    expect(status.staleSdkConnections).toEqual([
      { id: "gone", reason: "deleted" },
    ]);
  });

  it("reports every reason that applies", () => {
    expect(
      getQaOverrideStatus(
        {
          ...base,
          assignment: forced("deleted"),
          filters: { sdkConnections: ["gone"] },
        },
        none,
      ).invalidReasons,
    ).toEqual(["variation-removed", "no-matching-connection"]);
  });

  it("is waiting on a Feature Flag only when nothing is invalid", () => {
    const linkedFeatures = [linked("flag", "live", { dev: "disabled-env" })];
    const waiting = getQaOverrideStatus(base, { ...none, linkedFeatures });
    expect(waiting.status).toBe("waiting");
    expect(waiting.waitingOn).toEqual([
      { featureId: "flag", reason: "disabled-env" },
    ]);

    const invalid = getQaOverrideStatus(
      { ...base, assignment: forced("deleted") },
      { ...none, linkedFeatures },
    );
    expect(invalid.status).toBe("invalid");
    expect(invalid.waitingOn).toHaveLength(1);
  });
});
