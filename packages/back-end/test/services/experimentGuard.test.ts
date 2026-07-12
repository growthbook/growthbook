import {
  computeExperimentGuardConflictKeys,
  experimentGuardConflictsAcknowledged,
  decideExperimentGuard,
} from "back-end/src/services/experimentGuard";

type Impl = Parameters<typeof computeExperimentGuardConflictKeys>[0][number];

const impl = (over: Partial<Impl>): Impl => ({
  configKey: "base",
  relation: "self",
  experimentStatus: "running",
  state: "live",
  ...over,
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
