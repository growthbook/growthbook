import {
  computeExperimentGuardConflictKeys,
  experimentGuardKeySetsEqual,
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
    const keys = computeExperimentGuardConflictKeys([
      impl({ configKey: "base", relation: "self" }),
      impl({ configKey: "mobile", relation: "descendant" }),
    ]);
    expect([...keys].sort()).toEqual(["base", "mobile"]);
  });

  it("excludes ancestors and lateral mixins (publish doesn't change them)", () => {
    const keys = computeExperimentGuardConflictKeys([
      impl({ configKey: "parent", relation: "ancestor" }),
      impl({ configKey: "sibling", relation: "other" }),
    ]);
    expect(keys.size).toBe(0);
  });

  it("ignores non-running experiments and non-live (draft) arms", () => {
    const keys = computeExperimentGuardConflictKeys([
      impl({ configKey: "a", experimentStatus: "stopped" }),
      impl({ configKey: "b", experimentStatus: "draft" }),
      impl({ configKey: "c", experimentStatus: undefined }),
      impl({ configKey: "d", state: "draft" }),
    ]);
    expect(keys.size).toBe(0);
  });

  it("dedupes a config referenced by multiple running arms", () => {
    const keys = computeExperimentGuardConflictKeys([
      impl({ configKey: "base" }),
      impl({ configKey: "base" }),
    ]);
    expect([...keys]).toEqual(["base"]);
  });
});

describe("experimentGuardKeySetsEqual", () => {
  it("is order-independent", () => {
    expect(experimentGuardKeySetsEqual(new Set(["a", "b"]), ["b", "a"])).toBe(
      true,
    );
  });
  it("detects divergence and size mismatch", () => {
    expect(experimentGuardKeySetsEqual(new Set(["a", "b"]), ["a"])).toBe(false);
    expect(experimentGuardKeySetsEqual(new Set(["a"]), ["a", "b"])).toBe(false);
    expect(experimentGuardKeySetsEqual(new Set(["a"]), ["b"])).toBe(false);
  });
  it("treats null/undefined acknowledgment as empty", () => {
    expect(experimentGuardKeySetsEqual(new Set(), null)).toBe(true);
    expect(experimentGuardKeySetsEqual(new Set(["a"]), null)).toBe(false);
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

    it("blocks (terminal) when the fingerprint diverged", () => {
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
