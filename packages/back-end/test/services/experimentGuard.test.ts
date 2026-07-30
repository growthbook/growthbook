import {
  computeExperimentGuardConflictKeys,
  experimentGuardConflictsAcknowledged,
  decideExperimentGuard,
  configPublishAffectedRoots,
  configChangeAffectsServedValue,
  configRevisionAffectsServedValue,
  constantChangeAffectsServedValue,
  constantRevisionAffectsServedValue,
} from "back-end/src/services/experimentGuard";

type Impl = Parameters<typeof computeExperimentGuardConflictKeys>[0][number];

const impl = (over: Partial<Impl>): Impl => ({
  configKey: "base",
  relation: "self",
  experimentStatus: "running",
  state: "live",
  ...over,
});

describe("served-value change classification", () => {
  it("treats project and archived changes as value-affecting (refs are scrubbed)", () => {
    expect(configChangeAffectsServedValue(["project"])).toBe(true);
    expect(configChangeAffectsServedValue(["archived"])).toBe(true);
    expect(constantChangeAffectsServedValue(["project"])).toBe(true);
    expect(constantChangeAffectsServedValue(["archived"])).toBe(true);
  });

  it("still skips metadata-only changes", () => {
    expect(configChangeAffectsServedValue(["name", "description"])).toBe(false);
    expect(constantChangeAffectsServedValue(["name", "owner"])).toBe(false);
  });

  it("classifies revision patch ops by their top-level field", () => {
    expect(
      configRevisionAffectsServedValue([
        { op: "replace", path: "/archived", value: true },
      ]),
    ).toBe(true);
    expect(
      constantRevisionAffectsServedValue([
        { op: "replace", path: "/project", value: "prj_a" },
      ]),
    ).toBe(true);
    expect(
      constantRevisionAffectsServedValue([
        { op: "replace", path: "/name", value: "renamed" },
      ]),
    ).toBe(false);
  });
});

describe("computeExperimentGuardConflictKeys", () => {
  it("collects self + descendant configs backing a running live arm", () => {
    const keys = computeExperimentGuardConflictKeys(
      [
        impl({ configKey: "base", relation: "self" }),
        impl({ configKey: "mobile", relation: "descendant" }),
      ],
      new Set(["base", "mobile"]),
    );
    expect([...keys].sort()).toEqual(["base", "mobile"]);
  });

  it("only counts a served config that itself opts into the guard", () => {
    // Publishing an unguarded config still conflicts with a guarded descendant
    // it feeds (mobile), but not an unguarded one (web) — guarding is a property
    // of the served config, not the published one.
    const keys = computeExperimentGuardConflictKeys(
      [
        impl({ configKey: "base", relation: "self" }),
        impl({ configKey: "mobile", relation: "descendant" }),
        impl({ configKey: "web", relation: "descendant" }),
      ],
      new Set(["mobile"]),
    );
    expect([...keys]).toEqual(["mobile"]);
  });

  it("excludes ancestors and lateral mixins (publish doesn't change them)", () => {
    const keys = computeExperimentGuardConflictKeys(
      [
        impl({ configKey: "parent", relation: "ancestor" }),
        impl({ configKey: "sibling", relation: "other" }),
      ],
      new Set(["parent", "sibling"]),
    );
    expect(keys.size).toBe(0);
  });

  it("ignores non-running experiments and non-live (draft) arms", () => {
    const keys = computeExperimentGuardConflictKeys(
      [
        impl({ configKey: "a", experimentStatus: "stopped" }),
        impl({ configKey: "b", experimentStatus: "draft" }),
        impl({ configKey: "c", experimentStatus: undefined }),
        impl({ configKey: "d", state: "draft" }),
      ],
      new Set(["a", "b", "c", "d"]),
    );
    expect(keys.size).toBe(0);
  });

  it("dedupes a config referenced by multiple running arms", () => {
    const keys = computeExperimentGuardConflictKeys(
      [impl({ configKey: "base" }), impl({ configKey: "base" })],
      new Set(["base"]),
    );
    expect([...keys]).toEqual(["base"]);
  });

  it("keys conflicts per (config, experiment) — a different experiment is a new conflict", () => {
    // The arm-time fingerprint must go stale when a DIFFERENT experiment starts
    // on an acknowledged config: with config-key-only identity, E1 stopping and
    // E2 starting between arm and fire kept the set equal and published over E2.
    const armTime = computeExperimentGuardConflictKeys(
      [impl({ configKey: "base", experimentId: "exp_1" })],
      new Set(["base"]),
    );
    const fireTime = computeExperimentGuardConflictKeys(
      [impl({ configKey: "base", experimentId: "exp_2" })],
      new Set(["base"]),
    );
    expect([...armTime]).toEqual(["base|exp:exp_1"]);
    expect(experimentGuardConflictsAcknowledged(fireTime, [...armTime])).toBe(
      false,
    );
    // The acknowledged experiment stopping is still a covered subset.
    expect(
      experimentGuardConflictsAcknowledged(new Set<string>(), [...armTime]),
    ).toBe(true);
  });

  it("keys a contextual-bandit arm by its bandit id", () => {
    const keys = computeExperimentGuardConflictKeys(
      [impl({ configKey: "base", contextualBanditId: "cb_1" })],
      new Set(["base"]),
    );
    expect([...keys]).toEqual(["base|cb:cb_1"]);
  });
});

describe("experimentGuardConflictsAcknowledged", () => {
  it("is order-independent for an exact match", () => {
    expect(
      experimentGuardConflictsAcknowledged(new Set(["a", "b"]), ["b", "a"]),
    ).toBe(true);
  });
  it("treats a subset as acknowledged (an experiment stopped)", () => {
    // Fewer live conflicts than acknowledged = strictly less disruption.
    expect(
      experimentGuardConflictsAcknowledged(new Set(["a"]), ["a", "b"]),
    ).toBe(true);
  });
  it("blocks when a conflict key was not acknowledged", () => {
    expect(
      experimentGuardConflictsAcknowledged(new Set(["a", "b"]), ["a"]),
    ).toBe(false);
    expect(experimentGuardConflictsAcknowledged(new Set(["a"]), ["b"])).toBe(
      false,
    );
  });
  it("treats null/undefined acknowledgment as empty", () => {
    expect(experimentGuardConflictsAcknowledged(new Set(), null)).toBe(true);
    expect(experimentGuardConflictsAcknowledged(new Set(["a"]), null)).toBe(
      false,
    );
  });
});

describe("decideExperimentGuard", () => {
  const conflicts = new Set(["base", "mobile"]);

  it("allows when the guard is off", () => {
    expect(
      decideExperimentGuard({
        guardEnabled: false,
        conflictKeys: conflicts,
        armed: false,
        ignoreWarnings: false,
      }).action,
    ).toBe("allow");
  });

  it("allows when there are no live conflicts (experiments stopped)", () => {
    expect(
      decideExperimentGuard({
        guardEnabled: true,
        conflictKeys: new Set(),
        armed: true,
        ignoreWarnings: false,
      }).action,
    ).toBe("allow");
  });

  describe("direct (unarmed) publish", () => {
    it("soft-blocks without ignoreWarnings, naming the keys sorted", () => {
      const d = decideExperimentGuard({
        guardEnabled: true,
        conflictKeys: conflicts,
        armed: false,
        ignoreWarnings: false,
      });
      expect(d).toEqual({
        action: "block-immediate",
        conflictKeys: ["base", "mobile"],
      });
    });

    it("allows with an explicit ignoreWarnings override", () => {
      expect(
        decideExperimentGuard({
          guardEnabled: true,
          conflictKeys: conflicts,
          armed: false,
          ignoreWarnings: true,
        }).action,
      ).toBe("allow");
    });
  });

  describe("deferred (armed) merge", () => {
    it("allows when the acknowledged fingerprint still matches", () => {
      expect(
        decideExperimentGuard({
          guardEnabled: true,
          conflictKeys: conflicts,
          armed: true,
          ignoreWarnings: true, // background job — must NOT blanket-allow
          acknowledgedKeys: ["mobile", "base"],
        }).action,
      ).toBe("allow");
    });

    it("allows when the live conflicts are a subset of the acknowledged set", () => {
      // An acknowledged experiment stopped before the deferred publish fired —
      // fewer conflicts than acknowledged, so nothing new is at risk.
      expect(
        decideExperimentGuard({
          guardEnabled: true,
          conflictKeys: new Set(["base"]),
          armed: true,
          ignoreWarnings: true,
          acknowledgedKeys: ["base", "mobile"],
        }).action,
      ).toBe("allow");
    });

    it("blocks (terminal) when a new unacknowledged key appears", () => {
      const d = decideExperimentGuard({
        guardEnabled: true,
        conflictKeys: conflicts,
        armed: true,
        ignoreWarnings: true,
        acknowledgedKeys: ["base"],
      });
      expect(d).toEqual({
        action: "block-deferred",
        conflictKeys: ["base", "mobile"],
      });
    });

    it("blocks when nothing was ever acknowledged", () => {
      expect(
        decideExperimentGuard({
          guardEnabled: true,
          conflictKeys: conflicts,
          armed: true,
          ignoreWarnings: true,
          acknowledgedKeys: null,
        }).action,
      ).toBe("block-deferred");
    });
  });
});

describe("configPublishAffectedRoots", () => {
  type Node = Parameters<typeof configPublishAffectedRoots>[0][number];
  const cfg = (key: string, selects?: string[]): Node => ({
    key,
    scopedOverrides: selects?.map((config) => ({ config })),
  });

  it("returns just the config itself when nothing selects it as a flavor", () => {
    const all = [cfg("base"), cfg("child")];
    expect(configPublishAffectedRoots(all, "child")).toEqual(["child"]);
  });

  it("includes a base that selects the config as a scoped-override flavor", () => {
    // Publishing flavor `prod-theme` rewrites `theme`'s per-env resolved value.
    const all = [cfg("theme", ["prod-theme"]), cfg("prod-theme")];
    expect(configPublishAffectedRoots(all, "prod-theme").sort()).toEqual([
      "prod-theme",
      "theme",
    ]);
  });

  it("follows the flavor→base edge transitively", () => {
    const all = [
      cfg("a", ["b"]), // a selects flavor b
      cfg("b", ["c"]), // b selects flavor c
      cfg("c"),
      cfg("unrelated"),
    ];
    expect(configPublishAffectedRoots(all, "c").sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("is cycle-safe when scopedOverrides form a loop", () => {
    const all = [cfg("x", ["y"]), cfg("y", ["x"])];
    expect(configPublishAffectedRoots(all, "x").sort()).toEqual(["x", "y"]);
  });

  it("does not pull in a base that selects a DIFFERENT flavor", () => {
    const all = [
      cfg("base", ["other-flavor"]),
      cfg("flavor"),
      cfg("other-flavor"),
    ];
    expect(configPublishAffectedRoots(all, "flavor")).toEqual(["flavor"]);
  });
});
