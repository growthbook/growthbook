import { lockedDependentConfigKeys } from "back-end/src/services/configLockGuard";

describe("lockedDependentConfigKeys", () => {
  // isLocked predicate: only these config keys are locked.
  const locked =
    (...keys: string[]) =>
    (k: string) =>
      keys.includes(k);

  it("returns the locked config dependents, ignoring constant tokens", () => {
    const affected = new Set([
      "constant:src",
      "config:a",
      "config:b",
      "config:c",
    ]);
    const out = lockedDependentConfigKeys(affected, locked("a", "c"));
    expect([...out].sort()).toEqual(["a", "c"]);
  });

  it("returns empty when no dependent config is locked", () => {
    const affected = new Set(["constant:src", "config:a", "config:b"]);
    expect(lockedDependentConfigKeys(affected, locked()).size).toBe(0);
  });

  it("excludes the published config itself (its own lock is a separate hard block)", () => {
    const affected = new Set(["config:self", "config:child"]);
    const out = lockedDependentConfigKeys(affected, locked("self", "child"), {
      source: "config",
      key: "self",
    });
    expect([...out]).toEqual(["child"]);
  });

  it("does not exclude a config whose key matches the published CONSTANT's key", () => {
    // A constant and a config can share a bare key; the namespace keeps them
    // distinct, so publishing constant `shared` must still flag locked config `shared`.
    const affected = new Set(["constant:shared", "config:shared"]);
    const out = lockedDependentConfigKeys(affected, locked("shared"), {
      source: "constant",
      key: "shared",
    });
    expect([...out]).toEqual(["shared"]);
  });

  it("ignores non-config tokens entirely", () => {
    const affected = new Set(["constant:a", "constant:b"]);
    expect(lockedDependentConfigKeys(affected, locked("a", "b")).size).toBe(0);
  });
});
